# Прогресс лабораторной работы №4

## 2026-11-21 — исследование и проектирование

Статус: документационный этап завершён; рабочий код не изменялся.

### Исследовано

- root npm workspaces, scripts запуска, build, typecheck и test;
- backend Express/HTTPS bootstrap и TLS 1.3 configuration;
- Prisma schema и история migrations;
- service accounts, API keys, token exchange/refresh/logout и session revocation;
- роли, service permission allowlist и FHIR middleware;
- существующий `/api/service-auth/test-connection`;
- модели Patient, Diagnosis, MedicalRecord и MedicalRecordEvent;
- транзакционные patient/medical-record services и event replay;
- audit model, metadata validation, admin routes и Audit UI;
- certificate generation/verification scripts и локальный CA;
- Electron LIS main/preload/IPC, `safeStorage`, SQLite и connection service;
- документация и tests лабораторных №1–3;
- наличие XML/HL7/MLLP материалов в репозитории.

### Фактические выводы

- XML-пример преподавателя и XSD в репозитории отсутствуют.
- HL7/MLLP реализации пока нет.
- Существует только роль `LIS`; создание service account hard-coded на неё.
- Refresh/access authentication service сейчас явно принимает только `LIS`.
- Точный требуемый route `/api/testConnection` отсутствует; существующий route
  имеет путь `/api/service-auth/test-connection`.
- Patient не имеет внешнего ID.
- Diagnosis идентифицируется уникальным шестисимвольным code, а name также
  ошибочно ограничен unique и длиной 24 для будущего импорта.
- Diagnosis пациента существует только как event медицинской карты.
- `MedicalRecordEvent` требует `workerId`, поэтому сервисный импорт нельзя
  корректно представить без расширения author model.
- `AuditEvent.metadata` достаточен для certificate identity; отдельная audit
  table не нужна.
- Существующий LIS является подходящим технологическим образцом, но не должен
  совмещать учётные записи и назначение с HL7 Import.

### Принятые решения

- отдельный Electron workspace `hl7-importer` в текущем monorepo;
- обязательный настраиваемый Source System ID и composite external identity;
- новый diagnosis без name отклоняет весь patient import;
- UAC передаёт raw compact JWT в ED data с локальным credential code;
- standard A28 structure включает обязательный `PV1|...|N`;
- один transaction и один ACK на пациента;
- сервисный actor добавляется в существующий event stream вместо synthetic
  medical worker или отдельной diagnosis relation;
- client certificate CN справочный, а audit сохраняет subject/issuer/serial/
  fingerprint; certificate не связывается с account;
- неизвестный сетевой исход не повторяется автоматически.

### Созданная документация

- `docs/lab4/SPEC.md` — требования, HL7/UAC/ACK contracts, mapping, security,
  errors, tests и assumptions;
- `docs/lab4/PLAN.md` — этапы schema/auth/import/MLLP/certificates/desktop и
  verification commands;
- `docs/lab4/PROGRESS.md` — этот фактический журнал.

### Команды исследования

Использовались только read-only команды:

```powershell
git status --short
git log -8 --oneline --decorate
rg --files -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/build/**'
rg -n -i --hidden -g '!node_modules/**' -g '!.git/**' 'xml|ADT\^A28|HL7|MLLP|UAC|testConnection|test-connection' .
Get-Content package.json
Get-Content backend/package.json
Get-Content frontend/package.json
Get-Content lis/package.json
Get-Content backend/prisma/schema.prisma
Get-Content backend/src/app.ts
Get-Content backend/src/server.ts
Get-Content backend/src/services/service-auth.ts
Get-Content backend/src/services/service-permissions.ts
Get-Content backend/src/services/patient.ts
Get-Content backend/src/services/medical-record.ts
Get-Content backend/src/services/audit.ts
Get-Content lis/src/main/auth/connection-service.ts
Get-Content certificates/generate-certificates.ps1
Get-Content certificates/verify-certificates.ps1
```

Также сверены структуры A28, UAC и ACK с опубликованной документацией HL7 v2.8.

### Проверки документационного этапа

- Полный test suite не запускался: рабочий код, schema и dependencies не
  изменялись.
- `git diff --check` — успешно, whitespace errors отсутствуют.
- `rg`-проверка обязательных контрактов (`HL7_IMPORT`, `ADT^A28^ADT_A05`, UAC,
  MSA-3, external ID и XML dependency) — успешно.
- `git status --short` перед commit показал только новый каталог `docs/lab4`.

### Внешняя зависимость для реализации

До завершения XML adapter требуется обезличенный XML-пример преподавателя и, при
наличии, XSD. Остальные этапы могут использовать зафиксированный внутренний DTO
и HL7 fixtures, не выдавая предполагаемую XML-структуру за настоящий контракт.

## 2026-11-21 — этап №2: безопасная основа HL7 Import

Статус: реализация завершена, MLLP listener и HL7 import не начинались.

### Реализовано

- добавлена роль `HL7_IMPORT` в Prisma, service JWT exchange/refresh и
  административный интерфейс;
- сохранён default-deny: роль не получила FHIR, HIS CRUD, admin, LIS test или
  service logout permissions;
- добавлен общий `GET /api/testConnection` для активных user/admin/service
  access tokens;
- в `Patient` добавлены nullable source/value внешнего ID, composite unique
  index и CHECK полноты пары;
- добавлен безопасный loader конфигурации отдельного MLLP TLS-порта: TLS 1.3,
  обязательный доверенный client certificate, без изменения HTTPS API;
- добавлены OpenSSL clientAuth profile, воспроизводимый PowerShell script и
  инструкция `docs/lab4/CERTIFICATES.md`;
- server certificate предыдущих этапов переиспользуется: его EKU `serverAuth`
  и SAN подходят для локальных `localhost`/`127.0.0.1`.

### Граница этапа

Конфигурация MLLP mTLS подготовлена, но listener не запускается и HL7 payload не
принимается. Parser, UAC, ACK, атомарный импорт и audit certificate identity
остаются этапом №3.

### Проверки

Выполнены:

```powershell
npm run prisma:generate
npm run prisma:validate
npm run typecheck --workspace backend
npm run typecheck --workspace frontend
npm run test:unit --workspace backend
npm run test --workspace frontend -- ServiceAccountsPage
npm run certs:verify
npm run build --workspace backend
npm run build --workspace frontend
git diff --check
```

Результаты:

- Prisma schema valid, client успешно сгенерирован;
- backend unit: 9 files, 39 tests passed;
- frontend targeted: 1 file, 2 tests passed;
- backend/frontend typecheck и build прошли;
- CA/server certificate chain, serverAuth и SAN проверки прошли;
- PowerShell client certificate script разобран без syntax errors;
- OpenSSL client profile сформировал валидный CSR с clientAuth extensions;
- `git diff --check` не обнаружил whitespace errors;
- Vite сохранил существующее предупреждение о chunk больше 500 kB; build не
  завершился ошибкой.

Для проверки migration и database constraints автоматически создана отдельная
временная PostgreSQL database `medsoft_lab4_test` с non-superuser ролью
`his_lab4_test_user`. Выполнены `prisma migrate deploy` и только
`tests/service-auth.test.ts`: все 12 migrations применены, 1 test file и 14 tests
passed. После проверки временные database и role удалены; development database
`medsoft` не изменялась.

## 2026-11-21 — этап №3: HL7 v2.8 MLLP server и атомарный импорт

Статус: серверная часть этапа завершена; desktop-интерфейс и XML adapter не
разрабатывались.

### Реализовано

- отдельный TLS 1.3 TCP listener запускается вместе с HTTPS backend и требует
  доверенный клиентский сертификат (`requestCert` и `rejectUnauthorized`);
- stateful MLLP decoder поддерживает fragmented/combined chunks, несколько
  последовательных сообщений, лимит размера и idle timeout; некорректный frame
  закрывает только текущее соединение;
- реализован узкий HL7 v2.8 codec для `ADT^A28^ADT_A05`, `MSH`, обязательного
  `UAC`, `PID`, повторяющихся `DG1`, допустимых `EVN`/`PV1`, реальных номеров
  полей, настраиваемых delimiters и escape-последовательностей;
- JWT передаётся в согласованном UAC ED-профиле и для каждого сообщения
  проверяется существующим service-auth механизмом; импорт разрешён только роли
  `HL7_IMPORT`;
- добавлена аутентифицированная проверка MLLP без создания пациента:
  `QBP^Q11^QBP_Q11` с профилем `MEDSOFT_CONNECTION_TEST` и ответом
  `ACK^Q11^ACK`;
- пациент, медицинская карта, новые диагнозы, `DIAGNOSIS_ADDED` events и audit
  успеха сохраняются в одной Prisma transaction; event author — сервисный
  аккаунт без фиктивного медицинского работника;
- composite unique external ID остаётся окончательной защитой от параллельных
  дублей; повторный импорт возвращает `AE` и не меняет данные;
- ACK возвращает `AA`, `AE` или `AR`, коррелирует `MSA-2` с исходным `MSH-10`,
  а специальный `MSA-3` содержит HIS patient ID либо безопасный текст ошибки;
- success/failure audit сохраняет subject, issuer, serial, validity и SHA-256
  fingerprint клиентского сертификата; административный Audit UI показывает
  ключевые идентифицирующие поля явно;
- `PID-11` и `PID-13` разбираются в DTO, но не сохраняются, поскольку текущая
  модель пациента не содержит адреса/телефона и расширение модели не входит в
  этот этап;
- существующая уникальность названия диагноза сохранена; максимальная длина
  названия расширена до 160 символов для DG1.

### Изменения схемы

- `MedicalRecordEvent.workerId` стал nullable;
- добавлен nullable `serviceAccountId` с FK/index и DB CHECK: ровно один actor
  (`workerId` или `serviceAccountId`) обязан быть задан;
- `Diagnosis.name` расширен до `VARCHAR(160)` без снятия существующей
  уникальности.

### Фактические проверки

На отдельной временной PostgreSQL database `medsoft_lab4_stage3_test` с
non-superuser ролью `his_lab4_stage3_test_user` выполнены все migrations и полный
backend integration profile. После прогона database и role удалены; development
database не изменялась.

```powershell
npm exec --workspace backend -- tsx scripts/run-lab4-stage3-integration.ts
npm run test --workspace frontend -- AuditPage
```

Результаты на момент реализации:

- Prisma migrate deploy: 13 migrations успешно применены на чистой БД;
- backend integration: 15 files, 150 tests passed;
- реальные TLS 1.3/mTLS тесты проверили доверенный, отсутствующий и недоверенный
  client certificate, реальный MLLP exchange и JWT;
- frontend Audit UI: 1 file, 1 test passed.

Одноразовый runner временной БД после проверки удалён и не является частью
проекта. Дополнительно выполнены:

```powershell
npm run prisma:validate
npm run prisma:generate
npm run test:unit --workspace backend
npm run test --workspace frontend
npm run typecheck --workspace backend
npm run typecheck --workspace frontend
npm run build --workspace backend
npm run build --workspace frontend
npm run certs:verify
git diff --check
```

- backend unit: 11 files, 47 tests passed;
- frontend: 8 files, 39 tests passed;
- Prisma validate/generate, оба typecheck и оба build завершились успешно;
- certificate chain, identity, EKU и SAN checks прошли;
- frontend build сохранил известное предупреждение о chunk больше 500 kB, но
  завершился успешно;
- `git diff --check` не обнаружил whitespace errors.

### Оставшаяся граница

XML-схема и пример преподавателя по-прежнему отсутствуют. Точный XML adapter и
desktop-клиент остаются следующим этапом; сервер не предполагает вымышленный XML
контракт.

## 2026-11-22 — этап №4: desktop XML → HL7 Import

Статус: отдельное desktop-приложение реализовано и собрано; финальный аудит и
сквозная проверка с production-подобным HIS оставлены следующему этапу.

### Реализовано

- добавлен workspace `hl7-importer` на Electron 45, React 19, MUI, Zod и
  `fast-xml-parser`; существующий LIS не изменялся;
- Electron window использует sandbox, context isolation, отключённый Node в
  renderer, CSP, запрещённые permissions/navigation/window.open и проверку
  источника каждого IPC-вызова;
- настройки содержат HTTP(S) API, MLLP host/port, TLS server name, Source System
  ID, пути certificate/key/CA и timeout; файлы выбираются системными диалогами;
- проверка подключения последовательно выполняет API-key exchange, общий
  `GET /api/testConnection`, реальный TLS 1.3 mTLS handshake, проверку CA/SAN,
  `QBP^Q11^QBP_Q11` и коррелированный `ACK^Q11^ACK`;
- UI показывает независимые результаты API и MLLP, Subject/CN, Issuer, срок,
  serial, SHA-256 fingerprint и результат TLS verification;
- API key и access token не сохраняются; refresh token шифруется Electron
  `safeStorage`, а несекретные настройки сохраняются отдельным JSON в userData;
- существующий refresh endpoint используется до истечения access token и один
  раз после явного JWT rejection; ошибка refresh показывается как ошибка
  авторизации;
- для каждого пациента создаётся отдельный `ADT^A28^ADT_A05` с новым MSH-10,
  UAC JWT, PID, EVN/PV1 и повторяющимися DG1; HL7 ST значения экранируются;
- клиент проверяет тип/version ACK, `MSA-1`, корреляцию `MSA-2` и читает HIS ID
  или ошибку из `MSA-3`; разрыв после отправки помечается `UNKNOWN` без retry;
- импорт выполняется последовательно вне renderer thread, UI показывает список,
  прогресс, индивидуальный status/HIS ID/error, счётчики и прокручиваемую таблицу;
- добавлена классификация неправильного адреса, недоступности, timeout, TLS,
  недоверенного сертификата, authentication, forbidden и invalid ACK.

### XML

XML преподавателя и XSD по-прежнему отсутствуют. Добавлены изолированный
`DemoXmlAdapter` и `docs/lab4/demo-patients.xml`, оба явно обозначенные как
демонстрационные, а не официальные. Адаптер:

- принимает не более 2 МБ корректного UTF-8;
- запрещает `DOCTYPE` и `ENTITY`, не выполняет сетевое разрешение;
- валидирует обязательные поля, даты, пол и шестисимвольные diagnosis codes;
- сохраняет кириллицу и пропускает отдельную повреждённую запись с сообщением,
  не теряя остальные корректные записи.

Совместимость с форматом преподавателя остаётся внешней зависимостью и требует
реального обезличенного fixture. Инструкция: `docs/lab4/DESKTOP.md`.

### Фактические проверки

```powershell
npm install
npm run typecheck --workspace hl7-importer
npm run typecheck
npm run test --workspace hl7-importer
npm run build --workspace hl7-importer
npm run package:hl7-importer
```

- typecheck main/preload/renderer и общий typecheck всех workspaces прошли;
- unit/UI/live transport: 7 test files, 18 tests passed;
- временный test server подтвердил настоящий HTTPS token exchange и
  `/api/testConnection`, TLS 1.3 mTLS, hostname/CA verification, QBP/ACK;
- отдельно проверены недоверенный server certificate и отсутствие ACK после
  отправки с результатом `UNKNOWN`;
- Electron production build завершён;
- Windows x64 unpacked package создан в
  `hl7-importer/release/win-unpacked/MedSoft HL7 Importer.exe` без включения
  сертификатов, ключей или данных пациентов.

### Граница этапа

Не выполнялись общий финальный аудит, реальный импорт XML преподавателя и полный
сквозной acceptance-сценарий с основной HIS БД. Они относятся к следующему
этапу. Windows package не подписан code-signing сертификатом и использует
стандартную Electron icon; это не влияет на лабораторный протокол или проверки.

## 2026-11-22 — этап №5: сквозная валидация

Статус: автоматизированная сквозная проверка завершена; этап №6 не начинался.
Полный отчёт находится в `docs/lab4/VALIDATION.md`.

### Фактически проверено

- реальная цепочка desktop main process → HTTPS token API → общий
  `/api/testConnection` → TLS 1.3 mTLS → QBP/ADT MLLP → PostgreSQL → ACK →
  desktop result;
- два пациента и отдельные HIS ID, кириллица, диагнозы и certificate audit;
- duplicate без изменения существующего пациента и без побочного диагноза;
- rollback пациента и ранее созданного диагноза при ошибке следующего диагноза,
  при этом независимый пациент успешно commit;
- incorrect API key/JWT/signature/role/user JWT, forbidden HTTP operations;
- missing/untrusted/expired client certificate, hostname mismatch и valid mTLS;
- malformed/fragmented/combined MLLP, version/PID/UAC/type errors, ACK
  correlation и timeout/UNKNOWN;
- конкурентный duplicate и регрессии существующих ролей, HTTPS, CRUD, LIS/FHIR.

### Изолированная среда

Два последовательных прогона использовали автоматически созданные clean
PostgreSQL databases `medsoft_lab4_stage5_test` и
`medsoft_lab4_stage5_full_test` с отдельными non-superuser roles. Применены все
13 migrations. После прогонов DB/roles и временные OpenSSL CA/server/client
certificates удалены; development DB не изменялась. Использовались только
синтетические пациенты.

### Результаты команд

```powershell
npm run test:integration
npm run test
npm run typecheck
npm run build
git diff --check
```

- backend integration: 15 files, 150 tests passed;
- desktop database E2E: 1 file, 1 test passed;
- общий test: frontend 39, backend 47, LIS 21, HL7 importer 18 tests passed;
- typecheck и build всех 4 workspaces прошли;
- lint: BLOCKED — lint script/config в проекте отсутствуют;
- XML преподавателя: BLOCKED — реальный XML/XSD не предоставлен;
- сохранились только известные нефатальные bundle-size warnings.

### Изменения по результатам

Рабочих дефектов протокола или атомарности не обнаружено. Исправлены только
ошибки нового validation harness: cross-workspace test вынесен в отдельный
desktop integration profile и использует общий admin/JWT fixture. Расширены
реальные проверки expired certificate, user JWT, hostname mismatch,
отсутствующего PID и пустого `MSA-2`.
