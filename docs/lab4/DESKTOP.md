# Desktop-клиент HL7 Import

## Граница XML-контракта

XML/XSD преподавателя в репозитории отсутствует. Файл `demo-patients.xml` и
адаптер `DemoXmlAdapter` являются только синтетическим демонстрационным форматом,
а не заявлением об официальной структуре. После получения реального образца
нужно заменить только изолированный XML-адаптер и его fixture-тесты, не меняя
HL7, MLLP или серверный контракт.

Демонстрационный формат имеет корень `medsoft-demo-patients`, повторяющиеся
элементы `patient` с атрибутом `externalId`, полями `firstName`, `middleName`,
`lastName`, `birthDate`, `sex`, необязательными `address`/`phone` и диагнозами
`diagnosis code/name`. DTD и ENTITY запрещены, размер файла ограничен 2 МБ,
кодировка — UTF-8. Некорректная запись пропускается с отдельным сообщением;
остальные записи остаются доступными для импорта.

## Подготовка

1. Создать сервисный аккаунт с ролью `HL7 Import` и один раз сохранить API key.
2. Выпустить клиентский сертификат по `docs/lab4/CERTIFICATES.md`.
3. Запустить PostgreSQL и backend; HTTPS API и отдельный MLLP listener должны
   быть доступны.
4. Для HTTPS API локальный CA передаётся приложению из настройки CA. Проверка
   сертификата и hostname не отключается.

## Режим разработки

```powershell
npm install
npm run dev:hl7-importer
```

В настройках указываются API URL, MLLP host/port, имя TLS-сервера из SAN,
Source System ID, API key и PEM-файлы client certificate/key/CA. Успешная кнопка
«Проверить соединение» выполняет token exchange, `GET /api/testConnection`,
реальный mTLS handshake, QBP Q11 и проверку ACK. API key не сохраняется; refresh
token хранится только в зашифрованном виде через Electron `safeStorage`.

## Сборка Windows

```powershell
npm run build --workspace hl7-importer
npm run package:hl7-importer
```

Распакованная сборка создаётся в `hl7-importer/release/win-unpacked`. Закрытые
ключи, сертификаты, API key и данные пациентов в пакет не включаются.

## Неопределённый исход

Если после отправки MLLP frame соединение оборвалось до корректного ACK,
результат помечается «Неизвестно». Автоматический повтор не выполняется, потому
что HIS мог уже зафиксировать пациента. Перед ручным решением следует проверить
HIS или повторить импорт осознанно, учитывая защиту от внешнего ID-дубликата.
