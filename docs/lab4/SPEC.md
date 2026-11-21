# Лабораторная работа №4: импорт пациентов по HL7 v2.8

## 1. Назначение и границы

HIS принимает пациентов из отдельного desktop-приложения сообщениями
`ADT^A28^ADT_A05` стандарта HL7 v2.8. Транспорт — MLLP поверх TLS 1.3 с
обязательным клиентским сертификатом. Каждому пациенту соответствует ровно одно
HL7-сообщение и один прикладной ACK после получения корректного MLLP frame.

В рамках лабораторной не используются FHIR, REST-импорт пациентов, брокеры
сообщений, CQRS-фреймворки или отдельный сервис. MLLP listener запускается в
процессе backend и вызывает общие сервисы авторизации, импорта, Prisma и аудита.
HTTP и MLLP остаются отдельными транспортными адаптерами.

## 2. Существующая архитектура и переиспользование

- Backend: Node.js/TypeScript, Express 5, Prisma 6, PostgreSQL. HTTPS listener
  использует TLS 1.3.
- Web UI: React 19, Vite, MUI, TanStack Query.
- Desktop-клиент лабораторной №3: Electron 45, React, Zod, SQLite и Electron
  `safeStorage`. Его назначение LIS и существующие сценарии не изменяются.
- Сервисные аккаунты уже имеют API key, EdDSA JWT access/refresh tokens,
  серверные refresh-сессии, ротацию и отзыв.
- Аудит уже поддерживает сервисного субъекта, JSON metadata и запись в общей
  транзакции с предметным изменением.
- Локальный CA и серверный TLS-сертификат уже создаются PowerShell/OpenSSL
  scripts; эта инфраструктура расширяется сертификатами с `clientAuth`.

## 3. Роль и HTTP-контракты

### 3.1 Роль

Отображаемое имя новой роли — `HL7 Import`, значение Prisma enum и JWT claim —
`HL7_IMPORT`. Существующая роль `LIS` сохраняется.

Для `HL7_IMPORT` разрешены только:

1. `POST /api/service-auth/token` — обмен API key на access/refresh pair;
2. `POST /api/service-auth/refresh` — ротация refresh token;
3. `GET /api/testConnection` — проверка access token и роли;
4. передача `ADT^A28^ADT_A05` через защищённый MLLP listener.

Любые HIS CRUD и FHIR endpoints, старый LIS endpoint
`/api/service-auth/test-connection`, иные HL7 message types и иные операции
запрещены по default-deny. Endpoint logout не входит в разрешения этой роли:
локальное отключение импортёра удаляет сохранённый refresh token, а отзыв всех
сессий выполняется существующими административными действиями деактивации или
ротации API key.

`GET /api/testConnection` требует `Authorization: Bearer <access-token>` и
возвращает:

```json
{
  "status": "connected",
  "role": "HL7_IMPORT"
}
```

Endpoint `/api/service-auth/test-connection` и его контракт для LIS не меняются.

### 3.2 Создание сервисного аккаунта

Административный API создания сервисного аккаунта принимает обязательное поле
`role` со значением `LIS` или `HL7_IMPORT`. Web UI требует явного выбора роли.
Существующие записи мигрируются как `LIS`; API key по-прежнему показывается
только в ответе на создание или ротацию.

## 4. HL7 v2.8 application profile

Сегменты кодируются UTF-8, завершаются байтом `CR` (`0x0D`), а специальные
символы экранируются по правилам из `MSH-2`. Поддерживается только профиль ниже;
неизвестные необязательные сегменты и repetitions не интерпретируются.

### 4.1 ADT A28

Порядок сегментов:

```text
MSH
UAC
EVN
PID
PV1
DG1 (0..*)
```

Поля профиля:

| Поле | Значение |
| --- | --- |
| MSH-2 | `^~\&` |
| MSH-3 | `MEDSOFT-HL7-IMPORTER` |
| MSH-4 | Source System ID из настроек клиента |
| MSH-5 | `MEDSOFT-HIS` |
| MSH-7 | время создания сообщения в HL7 DTM |
| MSH-9 | `ADT^A28^ADT_A05` |
| MSH-10 | новый UUID для корреляции запроса и ACK |
| MSH-11 | `P` |
| MSH-12 | `2.8` |
| MSH-18 | `UNICODE UTF-8` |
| EVN-1 | `A28` |
| EVN-2 | время события |
| PID-3.1 | внешний ID пациента |
| PID-3.4.1 | Source System ID |
| PID-3.5 | `PI` |
| PID-5 | `family^given^middle` |
| PID-7 | дата рождения `YYYYMMDD` |
| PID-8 | `M`, `F` или `U` |
| PV1-2 | `N` (not applicable) |
| DG1-1 | порядковый номер с 1 |
| DG1-3.1 | шестисимвольный код диагноза |
| DG1-3.2 | название диагноза |
| DG1-3.3 | `99MEDSOFT-DIAGNOSIS` |

PV1 включается, поскольку структура `ADT_A05`, используемая A28, требует этот
сегмент; `PV1-2=N` представляет отсутствие применимого визита. Комментарий
пациента не передаётся и сохраняется как `null`.

### 4.2 UAC с JWT

UAC следует непосредственно за MSH. Профиль задания:

```text
UAC|JWT^JSON Web Token^99MEDSOFT|MEDSOFT-HL7-IMPORTER^AP^jwt^A^{access-token}
```

- UAC-1 — локальный CWE-код типа credential;
- UAC-2 — ED: source application, type `AP`, subtype `jwt`, encoding `A`, data;
- JWT compact serialization передаётся без повторного Base64-кодирования;
- refresh token, API key и сертификат в HL7 payload не передаются.

Сервер применяет существующую проверку подписи EdDSA, issuer, audience, срока,
`tokenType=access`, `subjectType=service`, session ID, активности сессии и
аккаунта. Дополнительно требуется роль `HL7_IMPORT`. Сертификат и JWT являются
независимыми факторами: сопоставлять CN сертификата с аккаунтом программно не
требуется.

UAC по HL7 предназначен для передачи credential в простых протоколах без
собственной аутентификации, включая MLLP. Использование JWT в неинтерактивном
обмене является специальным профилем этой лабораторной работы.

### 4.3 ACK

ACK содержит `MSH`, `MSA` и, для ошибок, `ERR`:

```text
MSH|...||ACK^A28^ACK|{ack-control-id}|P|2.8||||||UNICODE UTF-8
MSA|{code}|{request-control-id}|{result-text}
ERR|...                         (только для ошибки)
```

Контракт MSA:

- `MSA-1=AA` — пациент сохранён; `MSA-3` содержит десятичный HIS patient ID;
- `MSA-1=AE` — корректный тип сообщения не обработан из-за JWT, данных,
  дубликата или предметной/транзакционной ошибки; `MSA-3` содержит безопасный
  текст ошибки;
- `MSA-1=AR` — неподдерживаемая версия, message type/trigger/structure или
  сообщение нельзя принять как запрос этого application profile;
- `MSA-2` повторяет `MSH-10`, если заголовок удалось разобрать;
- `ERR-3=207` используется для ошибок UAC; остальные ошибки получают
  подходящий прикладной код и диагностический текст;
- тексты экранируются как HL7 ST, ограничиваются по длине и не содержат stack
  trace, JWT, ключи, SQL или полный входной payload.

Если TLS handshake не состоялся, HL7 ACK невозможен. Если соединение оборвано
после отправки frame, клиент показывает неизвестный исход и не повторяет импорт
автоматически.

## 5. MLLP и mTLS

Каждый frame имеет вид:

```text
0x0B + HL7 payload + 0x1C + 0x0D
```

Listener обязан:

- принимать fragmented и несколько последовательно полученных frames;
- обрабатывать frames строго по очереди в пределах соединения;
- выдавать один ACK на каждый полный frame;
- иметь настраиваемые bind host/port, тайм-аут и лимит размера сообщения;
- использовать TLS 1.3, `requestCert=true`, `rejectUnauthorized=true` и
  доверенный client CA;
- закрывать соединение без ACK при TLS failure или при превышении лимита до
  возможности безопасно разобрать сообщение.

Конфигурация backend: `HL7_MLLP_HOST` (по умолчанию `127.0.0.1`),
`HL7_MLLP_PORT` (по умолчанию `2575`), пути к server certificate/key и client
CA, а также message size/idle timeout. По умолчанию используются существующие
локальные server certificate/key и CA.

Client certificate должен иметь EKU `clientAuth`; его CN заполняется точным
именем сервисного аккаунта для справки. Сервер не использует CN для решения об
авторизации.

## 6. Отображение данных

### 6.1 XML → внутренний DTO

В репозитории отсутствуют XML schema и пример преподавателя. Поэтому имена
XML-элементов, namespaces и cardinality не определяются до получения реального
образца. XML-specific код изолируется интерфейсом:

```ts
interface ImportPatient {
  externalId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  sex: 'MALE' | 'FEMALE' | 'UNKNOWN';
  diagnoses: Array<{ code: string; name: string | null }>;
}

interface PatientXmlAdapter {
  parse(xml: string): ImportPatient[];
}
```

Фактический adapter создаётся только после добавления обезличенного XML fixture
преподавателя и fixture-тестов. DTD/external entities запрещаются; malformed XML,
неподдерживаемая schema и превышение размера файла являются ошибками до отправки.

### 6.2 DTO → HL7 → HIS

| DTO | HL7 | HIS |
| --- | --- | --- |
| Source System ID setting | MSH-4, PID-3.4 | `Patient.externalIdSource` |
| `externalId` | PID-3.1 | `Patient.externalIdValue` |
| ФИО | PID-5 | поля `Patient` |
| `birthDate` | PID-7 | `Patient.birthDate` |
| `sex` | PID-8 | enum `Sex` |
| diagnosis code/name | DG1-3 | `Diagnosis` и `DIAGNOSIS_ADDED` event |

Внешний ключ `(externalIdSource, externalIdValue)` имеет постоянное уникальное
ограничение БД. Обычные ранее созданные пациенты могут иметь оба поля `null`.
HL7 import требует оба непустых поля. Повторный импорт по этому ключу завершается
`AE` без изменения пациента, диагнозов, событий или существующего аудита успеха.

## 7. Транзакционная модель импорта

Для одного сообщения одна Prisma-транзакция выполняет:

1. создание `Patient` с внешним идентификатором;
2. создание `MedicalRecord` в существующем locked состоянии;
3. поиск каждого `Diagnosis` по code;
4. создание отсутствующего диагноза по code и name;
5. создание последовательных `DIAGNOSIS_ADDED` events с версиями от 1;
6. запись успешного `HL7_PATIENT_IMPORTED` audit event;
7. commit, после которого формируется `AA` ACK.

Существующий диагноз переиспользуется, а его название импортом не изменяется.
Для нового кода название обязательно: при его отсутствии весь пациент
отклоняется. Медицинская запись события сохраняет snapshot кода и существующего
или нового названия.

`MedicalRecordEvent` получает nullable `serviceAccountId`, а существующий
`workerId` становится nullable. Ограничение БД требует ровно одного автора.
Существующие пользовательские операции и replay продолжают работать без
изменения смысла событий.

Ошибка до commit откатывает все шесть предметных действий. Неуспешная попытка
аудируется отдельной транзакцией как `HL7_PATIENT_IMPORT_FAILED`, поскольку
запись об отказе должна сохраниться после rollback.

## 8. Аудит

Audit metadata каждой попытки содержит:

- TLS certificate subject;
- issuer;
- serial number;
- SHA-256 fingerprint;
- срок действия сертификата;
- MSH-10 control ID, если доступен;
- authenticated service account ID, если JWT прошёл проверку;
- result/error category;
- при успехе HIS patient ID и внешний `(source, value)`.

Полный PEM/DER, private key, JWT, API key, refresh token и полный HL7/XML payload
не сохраняются. Успешный audit event входит в транзакцию пациента; отказ
записывается с сервисным actor после JWT-аутентификации либо anonymous/system
actor до неё.

Существующая таблица `AuditEvent` и административный экран достаточны; новая
таблица аудита не создаётся.

## 9. Desktop-приложение

Создаётся отдельный workspace `hl7-importer`, а не раздел существующего LIS.
Используются Electron, React, Zod, MUI, Electron security settings, trusted IPC
и `safeStorage`, уже применённые в репозитории.

Настройки:

- HTTPS origin HIS;
- MLLP host, port и TLS server name;
- Source System ID;
- client certificate path;
- private key path;
- trusted CA path.

API key вводится при настройке, обменивается на tokens и не сохраняется. Access
token находится только в памяти. Refresh token хранится зашифрованным через
`safeStorage`. Сохраняются пути к TLS-файлам, но не их содержимое.

Кнопка проверки подключения последовательно проверяет HTTP token/refresh,
`GET /api/testConnection` и отдельный mTLS handshake. Импортёр выбирает XML
системным file dialog, разбирает его в main process, показывает найденных
пациентов и отправляет их последовательно. Для каждого отображается:

- `SUCCESS` и HIS ID;
- `REJECTED` и MSA-3;
- `UNKNOWN`, если ACK не получен после возможной отправки.

Автоматического retry при `UNKNOWN` нет. При `AE` из-за истёкшего access token
разрешается один refresh и новая отправка, поскольку сервер подтвердил отказ и
не выполнил импорт.

## 10. Обработка ошибок

- XML/file errors не создают HL7-соединение и показываются в UI.
- TLS client/server verification errors не скрываются как прикладные ошибки.
- Некорректный MLLP frame закрывает соединение; если MSH доступен, сервер может
  вернуть `AR` перед закрытием.
- Некорректные или истёкшие JWT, inactive account и wrong role дают `AE` и ERR
  207, без предметных изменений.
- Duplicate external ID даёт `AE`, в том числе при конкурентной вставке,
  распознанной по unique constraint.
- Отсутствующий diagnosis name для нового code, неверные ФИО/дата/пол и
  нарушение текущих ограничений HIS дают `AE` и полный rollback пациента.
- Неожиданная серверная ошибка даёт нейтральный текст в ACK и подробный server
  log без раскрытия деталей клиенту.

## 11. Обязательные тесты и критерии приёмки

1. `HL7_IMPORT` получает и обновляет tokens, проходит `/api/testConnection`, но
   не имеет доступа к HIS CRUD, FHIR и LIS test endpoint.
2. LIS сохраняет существующие права и не получает доступ к HL7 import.
3. MLLP decoder корректно собирает fragmented frames и разделяет несколько
   frames; на каждый полный ADT приходит один коррелированный ACK.
4. Serializer/parser сохраняют UTF-8, delimiters, escapes, UAC, PID, PV1 и DG1.
5. Валидный mTLS certificate и JWT импортируют пациента и возвращают HIS ID в
   MSA-3.
6. Отсутствующий, недоверенный или просроченный client certificate не допускает
   MLLP session; client проверяет hostname и CA server certificate.
7. Неверный/истёкший JWT, wrong role и inactive account не изменяют БД.
8. Пациент, медкарта, новые диагнозы, events и audit commit атомарно; fault на
   каждом шаге оставляет предметную БД без частичных данных.
9. Существующий диагноз переиспользуется; новый создаётся по code; новый code
   без name отклоняет весь импорт.
10. Последовательный и конкурентный повтор `(source, externalId)` отклоняется и
    не изменяет ранее сохранённые данные.
11. Replay существующих и импортированных diagnosis events даёт одинаковую
    структуру состояния, а старые worker-authored events остаются валидными.
12. Audit содержит certificate identity и не содержит секретов/payload.
13. Admin UI создаёт аккаунты обеих ролей; существующие LIS tests проходят.
14. Desktop не сохраняет API/access token, защищает refresh token, не передаёт
    secrets в renderer и показывает отдельный результат каждого пациента.
15. XML adapter проходит fixture-тест по реальному образцу преподавателя; до
    появления fixture этот пункт явно остаётся внешней зависимостью.

## 12. Допущения и открытые данные

- XML-пример преподавателя, XSD и тестовые XML отсутствуют. Их структура не
  предполагается.
- Source System ID является обязательной настройкой desktop-клиента и одинаков
  в MSH-4 и PID-3.4.
- Коды диагнозов соответствуют текущему HIS-контракту: ровно 6 символов.
- Для отсутствующего кода требуется непустое название; техническое название из
  одного кода не генерируется.
- Один XML может содержать несколько пациентов, но каждый преобразуется в
  отдельное сообщение и получает отдельный ACK.
- Клиентские ключи генерируются без passphrase с ограниченными filesystem ACL,
  как существующий server key; поддержка PKCS#12 и HSM вне объёма работы.
- Сертификат служит аутентификацией TLS-клиента и источником audit identity, но
  не заменяет JWT и не привязывается к service account в БД.

## 13. Нормативные ссылки

- [HL7 v2.8, event A28](https://hl7.eu/HL7v2x/v28/hl7v28eventA28.htm)
- [HL7 v2.8.1, ADT A28 structure and ACK](https://hl7.eu/HL7v2x/v281/std281/ch03.html)
- [HL7 v2.8, UAC segment](https://hl7.eu/HL7v2x/v28/hl7v28segmUAC.htm)
- [HL7 v2.8 message structures](https://hl7.eu/HL7v2x/v28/hl7v28msgstruct.htm)
