# MedSoft LIS: разработка и подключение

MedSoft LIS — отдельное Electron-приложение. HIS продолжает работать с PostgreSQL, а LIS хранит только конфигурацию подключения и технические метаданные в SQLite `%APPDATA%/MedSoft LIS/medsoft-lis.sqlite`. Прямого доступа к БД HIS нет.

## Архитектура и безопасность

- `main` владеет SQLite, HTTPS/FHIR-клиентом, access/refresh-токенами и IPC.
- `preload` публикует четыре фиксированные операции `window.lis`; сырой `ipcRenderer` и Node API не экспортируются.
- `renderer` — React/MUI и не выполняет сетевые запросы.
- Включены `contextIsolation`, sandbox и `webSecurity`; Node integration выключен. Навигация, новые окна и permissions запрещены. Production UI загружается через локальный безопасный `app://` protocol с CSP.
- API key используется только для первого обмена и не сохраняется. Access token хранится в памяти. Refresh token шифруется асинхронным Electron `safeStorage` (Windows DPAPI) и только ciphertext сохраняется в SQLite. При недоступном secure storage подключение запрещается.
- Refresh rotation сериализуется single-flight операцией. Ошибка refresh очищает активную сессию и требует повторного подключения.

SQLite реализован встроенным `node:sqlite` Electron/Node без нативных addon. Миграции версионируются таблицей `schema_migrations` и выполняются транзакционно при запуске.

## TLS и локальный CA

LIS принимает только базовый HTTPS URL без credentials, query и fragment, запрещает redirects и не отключает проверку сертификатов. Для локального self-signed HIS установите корневой CA проекта в Windows `Trusted Root Certification Authorities` для текущего пользователя. Не используйте `NODE_TLS_REJECT_UNAUTHORIZED=0` или Chromium certificate-ignore flags.

## Команды

Из корня репозитория:

```powershell
npm install
npm run dev:lis
npm run typecheck --workspace lis
npm run test --workspace lis
npm run build --workspace lis
npm run package:lis
```

В development renderer обслуживается контролируемым локальным Vite server. Production build создаётся в `lis/out`, unpacked Windows package — в `lis/release` и не коммитится.

## Подключение

Администратор HIS создаёт активный сервисный аккаунт LIS и однократно передаёт API key оператору. На экране «Подключение» указываются HTTPS origin HIS и ключ. Main process последовательно вызывает token exchange, `test-connection` и FHIR R5 metadata, проверяя версию 5.0.0 и capabilities Patient/Practitioner/ServiceRequest read и Observation create.

Раздел «Запросы» загружает `ServiceRequest` постранично через FHIR R5, разрешает фильтрацию по `active`/`completed` и получает связанные Patient, Practitioner и Observation только в памяти main process. `Bundle.next` преобразуется в проверенный offset только после проверки HTTPS origin и FHIR path. Renderer получает подготовленные DTO через фиксированные IPC-операции и не видит FHIR URL или токены.

Patient и Practitioner кэшируются только в ограниченном временем жизни процесса кэше и очищаются при отключении. Необработанные назначения не сохраняются в SQLite. Выполненные запросы доступны только для просмотра.

## Фиксация результатов и история

ServiceRequest содержит extensions `https://medsoft.local/fhir/StructureDefinition/lab-result-kind` (`valueCode`: `TEXT` или `QUANTITY`) и `.../lab-result-unit` (`valueCoding` UCUM). Перед отправкой LIS повторно читает назначение, формирует финальный Observation и сначала транзакционно сохраняет операцию `PENDING` в SQLite. Identifier состоит из постоянного `connection_id` установки и UUID операции; `effectiveDateTime` также фиксируется до сети.

POST Observation использует `If-None-Exist: identifier=system|value`. Ответы 200 и 201 проходят проверку identifier, basedOn, Patient, LOINC, effectiveDateTime и значения, после чего одной SQLite-транзакцией создаётся `completed_analysis` и submission переводится в `COMPLETED`. Сетевой неопределённый исход сохраняется как `UNKNOWN`, конфликт — как `CONFLICT`; сверка ищет Observation по исходному identifier и никогда не создаёт новый identifier для повтора.

История содержит только исследования, начатые этой установкой LIS, хранит минимальные snapshots пациента, врача и назначения и доступна без HIS. Необработанные ServiceRequest по-прежнему не сохраняются. Учебная версия опирается на изоляцию пользовательского профиля Windows для файла SQLite и не реализует полное шифрование медицинских snapshots на уровне базы.
