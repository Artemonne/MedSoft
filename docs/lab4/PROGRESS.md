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
