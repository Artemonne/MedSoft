# Клиентский сертификат HL7 Import

## Предварительные условия

Сначала должен существовать локальный educational CA и серверный сертификат:

```powershell
npm run certs:generate
npm run certs:verify
```

Серверный сертификат из `certificates/local/server.cert.pem` имеет EKU
`serverAuth` и SAN `localhost`/`127.0.0.1`, поэтому подходит для локального
MLLP TLS listener. При подключении по другому DNS/IP необходимо выпустить новый
server certificate с этим адресом в SAN; отключать hostname verification нельзя.

## Выпуск сертификата

Имя должно точно совпадать с `name` созданного сервисного аккаунта и будет
записано в CN только для справки:

```powershell
npm run certs:generate-client -- -ServiceAccountName "Patient Import"
```

Script запросит passphrase существующего CA либо прочитает её из временной
environment variable `MEDSOFT_CA_PASSPHRASE`. Passphrase и временный файл после
выпуска не сохраняются.

Результат находится в ignored каталоге
`certificates/local/clients/<name>-<hash>/`:

- `client.cert.pem` — сертификат с EKU `clientAuth`;
- `client.key.pem` — закрытый ключ с ограниченными filesystem permissions.

Для отдельного output directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File certificates/generate-client-certificate.ps1 `
  -ServiceAccountName "Patient Import" `
  -OutputDirectory "C:\secure\medsoft-hl7-client"
```

Повторная генерация требует явного `-Force` и делает ранее выданные файлы в этом
каталоге непригодными для продолжения использования клиентом.

## Проверка и установка

```powershell
npm run certs:verify
```

Проверяются цепочка CA, `CA:false`, EKU `clientAuth`, наличие CN, а для server
certificate — `serverAuth` и SAN. Для desktop-импортёра потребуются:

1. `client.cert.pem`;
2. `client.key.pem`;
3. `certificates/local/ca.cert.pem` как доверенный CA;
4. MLLP server name, совпадающий с SAN server certificate.

Закрытый ключ, CA private key, passphrase, API key и JWT нельзя коммитить или
передавать вместе с публичным сертификатом. CN не используется для привязки к
service account: прикладная авторизация дополнительно выполняется существующим
JWT роли `HL7_IMPORT`.

## Backend configuration

Подготовленный loader читает:

```dotenv
HL7_MLLP_HOST="127.0.0.1"
HL7_MLLP_PORT=2575
HL7_MLLP_TLS_KEY_PATH="../certificates/local/server.key.pem"
HL7_MLLP_TLS_CERT_PATH="../certificates/local/server.cert.pem"
HL7_MLLP_CLIENT_CA_PATH="../certificates/local/ca.cert.pem"
```

Он принудительно устанавливает TLS 1.3, `requestCert=true` и
`rejectUnauthorized=true`. На текущем этапе конфигурация подготовлена и
тестируется отдельно; MLLP listener и HL7 frame processing относятся к следующему
этапу.
