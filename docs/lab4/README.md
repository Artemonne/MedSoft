# Лабораторная работа №4: HL7-импорт пациентов

## Назначение и архитектура

MedSoft — учебная HIS. В лабораторной №4 отдельное Windows desktop-приложение читает XML,
получает JWT по API-ключу сервисного аккаунта и отправляет каждого пациента отдельным сообщением
HL7 v2.8 в HIS. Основной web-интерфейс и обычные CRUD-маршруты не используются как транспорт
импорта.

Компоненты:

- `frontend` — React/Vite web-интерфейс администратора и медработника;
- `backend` — Express/TypeScript, Prisma и PostgreSQL; одновременно поднимает HTTPS API и
  отдельный MLLP listener;
- `hl7-importer` — Electron/React desktop-клиент с изолированными XML-, HTTP- и MLLP-адаптерами;
- `backend/prisma` — схема и миграции БД.

Поток данных: desktop → HTTPS API (`JWT`) → MLLP поверх mTLS (`HL7 ADT^A28`) → транзакция
Prisma → PostgreSQL → `ACK` → результат отдельной строки desktop.

## Протоколы и права

HTTPS API и MLLP принимают только TLS 1.3. Обычный API использует проверяемый серверный
сертификат, но не требует клиентского сертификата. MLLP требует сертификат клиента, подписанный
доверенным CA, и проверяет серверную цепочку и имя узла.

Администратор создаёт сервисный аккаунт с ролью `HL7 Import` в разделе
`/admin/service-accounts`. Полный API-ключ показывается один раз. Desktop передаёт его в
`POST /api/service-auth/token`, получает существующие access/refresh JWT и обновляет access token
через `POST /api/service-auth/refresh`. Роль имеет доступ только к выдаче/обновлению токенов,
`GET /api/testConnection` и HL7-импорту. Права администратора, медработника, LIS/FHIR и CRUD ей
не выдаются. Access JWT каждого HL7-сообщения передаётся в `UAC-3` по профилю
`UAC|JWT^JSON Web Token^99MEDSOFT|Bearer|<token>`.

## HL7, ACK и сохранение

Один пациент преобразуется в одно `ADT^A28^ADT_A05` версии 2.8: `PID` содержит внешний ID и
персональные данные, повторяющиеся `DG1` — диагнозы, `UAC` — JWT. MLLP frame имеет вид
`0x0B + UTF-8 HL7 + 0x1C 0x0D`. Для проверки соединения desktop отправляет
`QBP^Q11^QBP_Q11` без пациента.

Ответ — `ACK^A28^ACK` (для проверки соединения — `ACK^Q11^ACK`). `MSA-1` равен `AA`, `AE` или
`AR`, `MSA-2` повторяет исходный `MSH-10`, а `MSA-3` по требованию работы содержит внутренний
числовой ID HIS при успехе либо безопасный текст ошибки. Завершение TCP-передачи без корректного
ACK не считается успехом и не вызывает автоматическую повторную отправку.

Внешняя идентичность хранится отдельно в `Patient.externalIdSource` и
`Patient.externalIdValue`. Уникальный индекс БД на их пару предотвращает дубликаты, включая
параллельные импорты. Пациент, медкарта, диагнозы, связи/события и аудит сохраняются в одной
транзакции. Отсутствующий диагноз создаётся по шестизначному коду при наличии наименования;
существующий переиспользуется. При отклонённом дубликате данные пациента и справочник диагнозов
не меняются.

Аудит фиксирует успех или ошибку HL7-импорта, сервисный аккаунт, control ID и сведения
клиентского сертификата (subject, issuer, serial number, SHA-256 fingerprint и период действия),
но не JWT, API-ключи, приватные ключи или медицинские поля.

## Подготовка и запуск

Требуются Node.js 20.19+, npm, PostgreSQL и OpenSSL. Из корня репозитория:

```powershell
npm install
Copy-Item backend\.env.example backend\.env
```

В `backend/.env` нужно задать собственный `DATABASE_URL`. Остальные фактические настройки и
значения по умолчанию находятся в `backend/.env.example`:

```dotenv
HL7_MLLP_HOST="127.0.0.1"
HL7_MLLP_PORT=2575
HL7_MLLP_TLS_KEY_PATH="../certificates/local/server.key.pem"
HL7_MLLP_TLS_CERT_PATH="../certificates/local/server.cert.pem"
HL7_MLLP_CLIENT_CA_PATH="../certificates/local/ca.cert.pem"
HL7_MLLP_MAX_MESSAGE_BYTES=102400
HL7_MLLP_IDLE_TIMEOUT_MS=10000
```

Применить миграции и создать локальные материалы, если они ещё не выпускались:

```powershell
npm exec --workspace backend -- prisma migrate deploy
npm run certs:generate
npm run certs:verify
npm run jwt:generate
npm run admin-bootstrap:generate
```

`admin-bootstrap:generate` показывает одноразовый секрет. Первичная настройка выполняется на
`https://localhost:5173/admin/setup`, последующий вход — на `/admin/login` с паролем и TOTP.
Чтобы браузер доверял учебному HTTPS-сертификату, импортируется только публичный CA:

```powershell
Import-Certificate `
  -FilePath .\certificates\local\ca.cert.pem `
  -CertStoreLocation Cert:\CurrentUser\Root
```

HIS запускается командой `npm run dev`: frontend слушает `https://localhost:5173`, backend API —
`https://localhost:3001`, MLLP/mTLS — `127.0.0.1:2575`. При переопределении путей MLLP они
разрешаются относительно `backend`; пути по умолчанию уже указывают на `certificates/local`.

## Клиентский сертификат

После создания аккаунта выпустите сертификат с его точным `name` в CN:

```powershell
npm run certs:generate-client -- -ServiceAccountName "Patient Import"
npm run certs:verify
```

Результат находится в игнорируемом каталоге
`certificates/local/clients/<name>-<hash>/`: `client.cert.pem` (`clientAuth`) и
`client.key.pem`. CA расположен в `certificates/local/ca.cert.pem`; серверный сертификат имеет
`serverAuth` и SAN `localhost`/`127.0.0.1`. CN служит справочной информацией и программно с
аккаунтом не связывается. Закрытые ключи, passphrase, API-ключ и JWT не коммитятся.

## Desktop и XML

Режим разработки:

```powershell
npm run dev:hl7-importer
```

Сборка Windows x64:

```powershell
npm run package:hl7-importer
```

Исполняемый файл создаётся в
`hl7-importer/release/win-unpacked/MedSoft HL7 Importer.exe`. В настройках по умолчанию указаны
API `https://localhost:3001`, MLLP `127.0.0.1:2575`, TLS server name `localhost`, Source System ID
`DESKTOP-IMPORT` и timeout `10000` мс. Также выбираются API-ключ, клиентские PEM certificate/key
и `certificates/local/ca.cert.pem`. API-ключ не сохраняется; refresh token хранится Electron
`safeStorage`, а несекретные настройки — в `hl7-importer.json` каталога Electron `userData`.

XML/XSD преподавателя в репозитории отсутствует. `docs/lab4/demo-patients.xml` — только
синтетический демонстрационный fixture для `DemoXmlAdapter`, не официальный формат. Адаптер
ограничивает файл 2 МБ, запрещает DTD/ENTITY, проверяет UTF-8 и обязательные поля и изолирован от
HL7-транспорта. Совместимость с реальным XML нужно проверить после получения образца.

Пошаговая защита описана в [DEMO.md](DEMO.md), подробные контракты — в [SPEC.md](SPEC.md),
результаты фактических проверок — в [VALIDATION.md](VALIDATION.md).

## Матрица соответствия

| Требование | Статус | Реализация | Фактическая проверка |
|---|---|---|---|
| Роль `HL7 Import`, минимальные права и UI создания | Реализовано | `backend/prisma/schema.prisma`, `backend/src/services/service-permissions.ts`, `frontend/src/pages/ServiceAccountsPage.tsx` | `backend/tests/service-auth.test.ts`, `backend/tests/authorization.test.ts`, `frontend/tests/ServiceAccountsPage.test.tsx` |
| Access/refresh JWT и общий `GET /api/testConnection` | Реализовано | `backend/src/routes/service-auth.ts`, `backend/src/routes/test-connection.ts` | `backend/tests/service-auth.test.ts`, `backend/tests/authorization.test.ts` |
| HL7 v2.8 ADT A28, PID, DG1 и UAC JWT | Реализовано | `backend/src/hl7/codec.ts`, `hl7-importer/src/main/hl7/codec.ts` | `backend/tests/hl7-codec.test.ts`, `hl7-importer/tests/hl7-codec.test.ts` |
| Один пациент — одно сообщение и ACK | Реализовано | `hl7-importer/src/main/importer-service.ts`, `backend/src/hl7/server.ts` | `hl7-importer/tests/live-connection.test.ts`, `hl7-importer/tests/his-e2e.integration.ts` |
| MLLP поверх TLS 1.3 с обязательным клиентским сертификатом | Реализовано | `backend/src/config/mllp-tls.ts`, `backend/src/hl7/server.ts`, `hl7-importer/src/main/hl7/mllp-client.ts` | `backend/tests/mllp-tls-config.test.ts`, `backend/tests/hl7-mllp.test.ts`, E2E |
| CN клиента содержит имя аккаунта, без программной привязки | Реализовано | `certificates/generate-client-certificate.ps1` | `npm run certs:verify`, TLS integration tests |
| Отдельный внешний ID и DB-уникальность | Реализовано | `backend/prisma/migrations/20261121210000_add_hl7_import_foundations/migration.sql`, `backend/src/hl7/import-service.ts` | `backend/tests/hl7-mllp.test.ts`, E2E duplicate/concurrency |
| Атомарное сохранение пациента и диагнозов | Реализовано | `backend/src/hl7/import-service.ts` | DB integration: rollback, duplicate и parallel scenarios |
| Создание отсутствующего диагноза по коду | Реализовано | `backend/src/hl7/import-service.ts` | `backend/tests/hl7-mllp.test.ts`, desktop DB E2E |
| HIS ID/ошибка в `MSA-3`, correlation по `MSA-2` | Реализовано | `backend/src/hl7/codec.ts`, `hl7-importer/src/main/hl7/codec.ts` | backend/importer codec и live connection tests |
| Аудит с идентификаторами сертификата | Реализовано | `backend/src/hl7/server.ts`, `backend/src/hl7/import-service.ts`, `frontend/src/pages/AuditPage.tsx` | `backend/tests/hl7-mllp.test.ts`, `frontend/tests/AuditPage.test.tsx`, E2E |
| Desktop: настройки, проверка двух каналов, сертификат | Реализовано | `hl7-importer/src/renderer/App.tsx`, `hl7-importer/src/main/importer-service.ts` | `hl7-importer/tests/App.test.tsx`, `live-connection.test.ts`, E2E |
| XML: безопасный адаптер, кириллица, ошибки отдельных строк | Реализовано для demo-формата | `hl7-importer/src/main/xml/demo-adapter.ts`, `docs/lab4/demo-patients.xml` | `hl7-importer/tests/xml-adapter.test.ts` |
| Совместимость с XML преподавателя | Отсутствует исходный файл | Изолированный адаптер готов к замене | BLOCKED в `VALIDATION.md`: XML/XSD не предоставлены |
| Desktop: прогресс и индивидуальный результат | Реализовано | `hl7-importer/src/renderer/App.tsx` | `hl7-importer/tests/App.test.tsx` |
| Refresh при истечении и отсутствие авто-retry неопределённого импорта | Реализовано | `hl7-importer/src/main/auth/token-service.ts`, `hl7-importer/src/main/importer-service.ts` | importer unit/live tests и E2E |
| Воспроизводимый Windows build | Реализовано | `hl7-importer/package.json`, `hl7-importer/electron.vite.config.ts` | общий `npm run build`, `npm run package:hl7-importer` на этапе №4 |
| Сквозной desktop → БД → ACK | Реализовано | весь перечисленный контур | `hl7-importer/tests/his-e2e.integration.ts`; результаты в `VALIDATION.md` |
