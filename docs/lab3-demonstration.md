# Демонстрация лабораторной работы №3

## Архитектура

HIS (React, Express, Prisma, PostgreSQL) и MedSoft LIS (Electron, React, SQLite) запускаются независимо. LIS не имеет доступа к PostgreSQL HIS: медицинский обмен выполняется только ресурсами FHIR R5 по HTTPS. API key используется один раз для получения SERVICE access/refresh-токенов. Refresh-токен и медицинские payload локальной истории защищены Windows DPAPI через Electron `safeStorage`.

## Подготовка

1. Настроить отдельную PostgreSQL test-базу по `docs/development-and-testing.md`. Не использовать development-базу `med`.
2. Выполнить `npm install`, `npm run prisma:generate`, `npm run check` и `npm run test:integration` с безопасными test-переменными.
3. Запустить HIS по HTTPS и убедиться, что локальный CA доверен Windows. Не отключать TLS-проверку.
4. Администратором HIS создать активный сервисный аккаунт LIS и сохранить однократно показанный API key.
5. Запустить `npm run dev:lis` или свежую packaged-сборку после `npm run package:lis`.

## Сценарий показа

1. В HIS врач выбирает несколько анализов из справочника LOINC и создаёт назначения. Каждому анализу соответствует отдельный ServiceRequest.
2. В LIS указать HTTPS origin HIS и API key. Показать успешную проверку FHIR 5.0.0.
3. Открыть список запросов, пациента и назначившего врача.
4. Ввести TEXT или QUANTITY результат и подтвердить финальную отправку.
5. В HIS открыть ЭМК: Observation отображается в разделе анализов и связан с Patient и ServiceRequest.
6. В LIS открыть локальную read-only историю после отключения HIS и перезапуска приложения.
7. При потерянном ответе запись остаётся `UNKNOWN`; сверка использует прежний identifier, а повторный POST не создаёт второй Observation.

## Проверки перед защитой

- HIS и LIS запускаются независимо; SQLite создаётся в `%APPDATA%/MedSoft LIS`.
- HTTPS-сертификат проходит штатную проверку, SERVICE-роль не получает пользовательские права.
- Один ServiceRequest не получает два результата при повторе или гонке.
- В SQLite медицинские payload и snapshots являются шифротекстом; открыты служебные идентификаторы, состояния и даты.
- Development-база не мигрировалась в ходе тестов.

## Ограничения учебной версии

- Это не сертифицированное медицинское ПО. Полного шифрования файла SQLite нет: защищены чувствительные поля.
- DPAPI привязывает расшифрование к профилю Windows; перенос файла не переносит ключи.
- Инсталлятор не подписан издателем.
- Сквозная проверка считается выполненной только с настоящими HIS, test PostgreSQL, HTTPS и Electron-LIS; mocks её не заменяют.

## Типовые вопросы

- Почему FHIR R5? `ServiceRequest.code` является `CodeableReference`, результат ссылается на запрос через `Observation.basedOn`.
- Почему локальная история? Она обеспечивает просмотр завершённых исследований без HIS, но не копирует все необработанные назначения.
- Как исключены дубли? LIS фиксирует identifier до сети и применяет conditional create; HIS транзакционно обеспечивает уникальность результата для ServiceRequest.
- Что при неизвестном исходе? Identifier не меняется: сначала выполняется поиск Observation, затем безопасный повтор conditional POST.

## Автоматический HTTPS E2E

`npm run test:integration` также запускает воспроизводимый backend ↔ LIS main-process сценарий. Нужны `TEST_DATABASE_URL` и `TEST_DATABASE_CONFIRMATION`, описанные в `docs/development-and-testing.md`. Runner самостоятельно проверяет выделенную test-базу и непривилегированного пользователя, применяет только committed migrations и добавляет проектный CA через `NODE_EXTRA_CA_CERTS` только дочернему тестовому процессу.

Сценарий поднимает настоящий HTTPS HIS с TLS 1.3 на случайном локальном порту, получает SERVICE access/refresh-токены через HTTP, читает FHIR R5 Patient, Practitioner и ServiceRequest и отправляет TEXT/QUANTITY Observation через реальные LIS main-process services. Дополнительно проверяются conditional retry с HTTP 200, отсутствие второго LabResult, потеря ответа с переходом `UNKNOWN`, сверка, локальная история после повторного открытия SQLite и отсутствие медицинского plaintext в файле тестовой базы.

SQLite и сервер создаются во временных каталогах и удаляются после теста. Рабочий `%APPDATA%/MedSoft LIS` не используется. В Node-сценарии граница secure storage реализована временным AES-GCM test adapter: он проверяет контракт ciphertext и хранение, но не подменяет ручную проверку Windows DPAPI. Фактическая доступность Electron `safeStorage` проверяется запуском packaged-приложения в отдельном временном `user-data-dir`.

Это не GUI E2E: renderer и действия мышью не автоматизированы. Перед защитой вручную показать подключение packaged LIS, список запросов, карточку, результат, историю и восстановление `UNKNOWN`.
