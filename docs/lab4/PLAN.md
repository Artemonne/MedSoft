# План реализации лабораторной работы №4

## Цель

Добавить в существующий HIS импорт пациентов сообщениями HL7 v2.8
`ADT^A28^ADT_A05` через MLLP/mTLS и отдельный Electron-клиент, не изменяя
работающие сценарии web HIS и LIS. Реализация выполняется последовательно;
следующий этап начинается только после проверок предыдущего.

## Этап 0. Получение XML-контракта

1. Получить обезличенный XML-пример преподавателя и, если существует, XSD или
   текстовое описание полей.
2. Сохранить fixture в tests нового desktop workspace без реальных персональных
   данных.
3. Зафиксировать таблицу XML path → `ImportPatient` в SPEC и fixture-тесте.
4. Не реализовывать production XML adapter по предполагаемой структуре. При
   отсутствии образца остальные backend/HL7 этапы можно выполнять с DTO fixtures,
   но XML acceptance criterion остаётся незавершённым.

Результат: подтверждённый XML contract либо явно зарегистрированная внешняя
зависимость, не замаскированная вымышленным форматом.

## Этап 1. Схема БД и управление ролями

### Prisma migration

Изменить `backend/prisma/schema.prisma` и добавить одну migration:

- `ServiceAccountRole`: добавить `HL7_IMPORT`;
- `Patient`: добавить nullable `externalIdSource varchar(100)` и
  `externalIdValue varchar(100)`, composite unique constraint;
- `Diagnosis.name`: убрать unique constraint и расширить до `varchar(160)`;
- `MedicalRecordEvent.workerId`: сделать nullable;
- `MedicalRecordEvent.serviceAccountId`: добавить nullable UUID FK на
  `ServiceAccount` с `onDelete: Restrict` и index;
- добавить SQL CHECK, требующий ровно один из `workerId`/`serviceAccountId`;
- добавить обратную relation events в `ServiceAccount`.

Migration не заполняет внешние ID существующих пациентов. Все существующие
service accounts остаются `LIS`; все существующие events сохраняют `workerId`.

### Admin API и UI

- Расширить create service account schema обязательным `role`.
- Передавать выбранную роль в service layer вместо hard-coded `LIS`.
- Добавить selector `LIS` / `HL7 Import` в `ServiceAccountsPage` и сохранить
  однократный показ API key.
- Обновить frontend API types и тесты создания/отображения аккаунта.

### Проверки этапа

```powershell
npm run prisma:validate
npm run prisma:generate
npm run typecheck --workspace backend
npm run test:unit --workspace backend -- service-security service-auth admin-accounts
npm run test --workspace frontend -- ServiceAccountsPage
```

Дополнительно применить migration к отдельной test database и проверить, что
старые events и LIS accounts читаются без изменения.

## Этап 2. Авторизация HL7 Import и testConnection

1. Обобщить `service-auth` проверки, сейчас hard-coded на LIS, для разрешённых
   значений `ServiceAccountRole`; сохранить проверку роли в session/account.
2. Оставить `/api/service-auth/test-connection` доступным только LIS.
3. Добавить root route `GET /api/testConnection`, который использует
   существующую Bearer-аутентификацию и доступен всем активным user, admin и
   service access tokens без выдачи дополнительных предметных прав.
4. Расширить permission model явными capabilities, чтобы роль HL7 Import не
   получила FHIR permissions при добавлении enum.
5. Не разрешать HL7 Import обычный `/logout` или предметные HTTP endpoints.
6. Добавить auth tests для token exchange, refresh rotation, deactivation,
   rotation/revocation, wrong subject и полного default-deny.

Публичное изменение: create-service-account request получает `role`, token pair
сохраняет прежнюю форму, новый response `/api/testConnection` имеет форму из
SPEC.

## Этап 3. Транспорт-независимый импорт

Создать узкий модуль импорта backend, принимающий валидированный DTO, service auth
context и certificate audit identity. Он не знает о sockets, MLLP framing и XML.

В одной `prisma.$transaction`:

1. создать `Patient` с composite external ID;
2. создать locked `MedicalRecord`;
3. для каждого DG1 найти `Diagnosis` по code; создать только отсутствующий и
   только при наличии name;
4. добавить `DIAGNOSIS_ADDED` events с `serviceAccountId` и последовательными
   версиями;
5. записать `HL7_PATIENT_IMPORTED` через существующий audit service;
6. вернуть созданный patient ID после commit.

Обработать Prisma unique violation composite external ID как стабильную ошибку
duplicate import. Не выполнять pre-check как единственную защиту от гонки. Для
существующего diagnosis не обновлять name. Failure audit писать отдельной
транзакцией с категорией ошибки, но без payload и secrets.

Существующий replay расширения не требует: payload diagnosis event остаётся тем
же. Read projections должны уметь показывать nullable worker и service-account
author, не подставляя фиктивного медицинского работника.

Тесты:

- success без диагнозов и с несколькими диагнозами;
- смесь существующих/новых codes;
- отсутствующее name нового code;
- rollback на каждом write step;
- последовательный и конкурентный duplicate external ID;
- event author CHECK и replay старых/новых streams;
- success/failure audit и фильтр запрещённых metadata keys.

## Этап 4. HL7 codec, MLLP и ACK

### Codec

Добавить backend modules для:

- разбора delimiters и сегментов требуемого application profile;
- HL7 escaping/unescaping;
- строгой проверки MSH/UAC/EVN/PID/PV1/DG1;
- преобразования в import DTO;
- формирования ACK/ERR по SPEC.

Не добавлять универсальную HL7 model или поддержку иных message types.

### Frame decoder

Stateful decoder принимает Buffer chunks, поддерживает fragmentation и несколько
frames, ограничивает размер и принимает только `VT ... FS CR`. Один frame
обрабатывается до начала следующего ACK в том же соединении.

### Listener

- Экспортировать factory для `tls.Server`, чтобы tests использовали ephemeral
  port и controlled certificates.
- В server bootstrap запустить HTTPS и MLLP listeners с общими auth/import/audit
  services и корректно закрывать оба listener при shutdown.
- Настройки читать из environment с defaults из SPEC; invalid configuration
  должна останавливать startup с понятной ошибкой.
- Из peer certificate извлекать subject, issuer, serial, validity и
  `fingerprint256` до передачи в import service.
- Из UAC извлекать только access token и вызывать существующую service access
  token authentication; требовать `HL7_IMPORT`.

ACK отправляется только после commit/rollback. Token и payload не логируются.

### Проверки этапа

- unit tests codec, escaping, invalid structures, ACK codes/MSA-2/MSA-3;
- decoder tests для разрезов каждого байта, нескольких frames и oversize;
- integration test реального TLS server: trusted client, missing certificate,
  чужой CA, expired/wrong-purpose certificate;
- end-to-end ADT import с реальным JWT и проверкой результата в PostgreSQL.

## Этап 5. Сертификаты

1. Добавить OpenSSL client config с `CA:false`, `digitalSignature`,
   `keyEncipherment` и `extendedKeyUsage=clientAuth`.
2. Добавить PowerShell script с обязательным параметром имени сервисного
   аккаунта. Script генерирует key/CSR/certificate, помещает имя в CN, подписывает
   существующим CA и применяет ограниченные ACL.
3. Не включать generated certificates/keys в Git; существующие ignore rules
   сохраняются.
4. Расширить verify script проверкой server/client purpose, цепочки CA, SAN
   server certificate и CN тестового client certificate.
5. Документировать, что имя в CN справочное и не заменяет JWT authorization.

Проверка:

```powershell
npm run certs:verify
```

Для automated tests использовать отдельные test certificates/временную
директорию, не перезаписывать `certificates/local`.

## Этап 6. Отдельный Electron workspace

Добавить `hl7-importer` в root workspaces и scripts, повторив минимальные
security patterns LIS без выноса общего framework:

- sandbox/context isolation, trusted custom renderer protocol, запрещённые
  permissions/navigation/window open;
- typed preload API и trusted-sender IPC;
- connection service для token exchange/refresh и exact testConnection;
- TLS/MLLP client на `node:tls` с `rejectUnauthorized=true`, CA, certificate,
  key, servername, timeout и frame size limit;
- локальная SQLite config только для несекретных настроек и encrypted refresh
  token; access token и API key не сохраняются;
- file dialog и XML parsing только в main process;
- sequential import coordinator и in-memory per-patient results.

Экран содержит настройки подключения, проверку HTTP+mTLS, выбор XML, список
пациентов и результаты. При потере соединения после send результат `UNKNOWN`, без
automatic retry. Renderer никогда не получает tokens, key contents или raw
certificate contents.

XML adapter реализовать по fixture этапа 0. Использовать прямую XML dependency,
а не случайную transitive dependency; запретить DOCTYPE/external entities и
ввести file-size limit.

Тесты workspace:

- validation настроек и HTTPS-only API origin;
- token storage/rotation и отсутствие secrets в IPC;
- TLS hostname/CA/client certificate handling;
- MLLP request/ACK correlation, timeout, malformed ACK и UNKNOWN outcome;
- XML fixture mapping и один outbound message на пациента;
- UI results SUCCESS/REJECTED/UNKNOWN.

## Этап 7. Интеграция, документация и приёмка

1. Добавить lab4 development/demo guide с командами выпуска service account,
   client certificate, запуска listeners и import desktop.
2. Выполнить сценарий: два пациента, существующий и новый diagnosis, затем
   повтор одного external ID.
3. Проверить HIS UI: пациенты, medical records, diagnosis snapshots и audit
   certificate metadata.
4. Проверить регрессию LIS, web CRUD, JWT rotation и существующего HTTPS.
5. Обновлять `docs/lab4/PROGRESS.md` после каждого реально завершённого этапа,
   записывая commands и результаты, а не планируемые проверки.

Финальные команды после локальных targeted tests:

```powershell
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run test:unit
npm run build
npm run test:integration
```

Integration suite запускается только с отдельным `TEST_DATABASE_URL`, как
описано в `docs/development-and-testing.md`. Commit каждого этапа содержит только
его изменения, создаётся после успешных проверок и не отправляется в remote.

## Критические риски и меры

| Риск | Мера |
| --- | --- |
| Нет XML преподавателя | Изолированный adapter и обязательный fixture gate |
| Duplicate race | Composite unique constraint и обработка DB conflict |
| Частично сохранённый пациент | Одна transaction на ADT message |
| Сервисное событие требует worker | Exact-one actor schema, без synthetic worker |
| JWT или payload попадёт в audit/log | Typed safe metadata и negative tests |
| TLS принят без client cert | `requestCert` + `rejectUnauthorized` + real TLS tests |
| Смешение LIS и HL7 permissions | Отдельная роль, endpoints и exhaustive matrix tests |
| Неизвестный исход при network loss | Нет automatic retry; UI `UNKNOWN`; duplicate guard |
| Регрессия лабораторной №3 | Отдельный Electron workspace и targeted LIS regression |

## Готовность

Backend, auth, audit, certificate CA и Electron patterns позволяют начать этапы
1–6 без смены технологического стека. Единственная внешняя зависимость — реальная
XML schema/fixture; она блокирует точный XML adapter и его acceptance test, но не
backend import, HL7 profile, MLLP/mTLS или desktop shell.
