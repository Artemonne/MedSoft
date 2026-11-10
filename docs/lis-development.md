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

Patient и Practitioner кэшируются только в ограниченном временем жизни процесса кэше и очищаются при отключении. Медицинские ресурсы не сохраняются в SQLite. Выполненные запросы доступны только для просмотра; ввод и POST Observation, а также постоянная история исследований относятся к следующему этапу.
