# Валидация лабораторной работы №4

Дата проверки: 2026-11-22. Проверка выполнена на Windows x64, Node.js 26,
PostgreSQL на `localhost` и OpenSSL из Git for Windows.

## 1. Проверенные сценарии

### A. Положительный сквозной сценарий — PASS

Автоматизированный E2E запустил настоящий Express HTTPS server и отдельный
TLS 1.3 MLLP listener, создал сервисный аккаунт `HL7_IMPORT`, обменял API key на
JWT, вызвал `GET /api/testConnection`, выполнил mTLS handshake и QBP Q11.

Desktop `ImporterService` прочитал XML с двумя синтетическими пациентами и
кириллицей, отправил два отдельных `ADT^A28^ADT_A05`, проверил два ACK и получил
два числовых HIS ID из `MSA-3`. В PostgreSQL подтверждены два пациента, две
медкарты, diagnosis events и два диагноза. Audit содержит ID сервисного аккаунта
и SHA-256 fingerprint фактически предъявленного клиентского сертификата.

Renderer отдельно проверен UI-тестами: список записей, индивидуальные статусы,
HIS ID, ошибки, прогресс и общие счётчики. Electron production build выполнен.

### B. Повторный импорт — PASS

Повторно отправлен существующий `(sourceSystemId, externalId)` с изменённым ФИО
и новым diagnosis code. Desktop получил `REJECTED`/`AE` с сообщением дубликата.
Количество пациентов не изменилось, `firstName`/`updatedAt` существующей записи
сохранились, новый диагноз не появился.

### C. Атомарность — PASS

Первый пациент содержал новый диагноз, а затем диагноз с новым code и именем,
конфликтующим с существующим DB unique constraint. Получен `AE`; пациент,
первый созданный внутри transaction диагноз и конфликтующий диагноз отсутствуют
после rollback. Следующий независимый пациент из того же XML успешно сохранён.

### D. Авторизация — PASS

Фактически проверены:

- неверный API key — HTTP 401 в service-auth integration tests;
- отсутствующий/некорректный UAC и отсутствующий JWT — `AE` до изменения БД;
- истёкший JWT — `AE`;
- JWT с повреждённой/неизвестной подписью — `AE`;
- access JWT обычного пользователя — отклонён MLLP application authorization;
- JWT сервисного аккаунта `LIS` — отклонён как wrong role;
- `HL7_IMPORT` на обычных HIS/FHIR/admin/LIS endpoints — default-deny tests;
- token exchange, refresh rotation и общий `/api/testConnection` для
  `HL7_IMPORT` — PASS.

### E. TLS — PASS

Реальными TLS-соединениями проверены:

- отсутствие client certificate — handshake отклонён;
- client certificate чужого CA — handshake отклонён;
- client certificate с `notAfter=notBefore` (`-days 0`) — отклонён как
  просроченный;
- неверный `servername` относительно SAN server certificate — desktop отклонил
  соединение;
- правильные CA/server/client certificates с `serverAuth`/`clientAuth` —
  TLS 1.3 handshake успешен;
- обычный HTTPS API продолжает работать без client certificate.

Проверка TLS нигде не отключалась.

### F. Протокол — PASS

Проверены повреждённый MLLP frame, fragmented frame, несколько сообщений в одном
соединении, два ACK, HL7 2.7, отсутствующий PID, некорректный/переставленный UAC,
неподдерживаемый message type, неправильный/пустой `MSA-2`, отсутствующий MSA и
тайм-аут/закрытие соединения до ACK. Последний случай desktop отображает как
`UNKNOWN` и не повторяет автоматически.

Unit tests отдельно подтверждают реальные offsets MSH-3/4/5/6/7/9/10/11/12,
PID-3/5/7/8/11/13, DG1-3 и HL7 escaping UTF-8/кириллицы.

### G. Параллельность — PASS

Два параллельных MLLP импорта одного внешнего ID дали ровно один `AA`, один `AE`
и одну строку пациента. Окончательная защита — composite unique constraint БД,
а не только предварительный SELECT.

### H. Регрессии — PASS

Полный backend integration profile (15 файлов, 150 тестов) подтвердил старые
роли, CRUD, medical record events, аудит, FHIR/LIS и HTTPS без mTLS. Общие тесты
frontend, backend, LIS и HL7 importer также прошли. Схема существующих HTTP
маршрутов и требование client certificate обычного HTTPS API не менялись.

## 2. Фактические результаты

| Область | Статус | Фактическое основание |
| --- | --- | --- |
| A: desktop → API → MLLP → БД → ACK | PASS | 1 реальный DB E2E test |
| B: повторный импорт | PASS | DB snapshot/count/new diagnosis assertions |
| C: атомарность | PASS | реальный unique failure внутри transaction |
| D: авторизация | PASS | backend unit/integration + реальный MLLP |
| E: TLS/mTLS | PASS | реальные TLS 1.3 handshakes |
| F: HL7/MLLP/ACK | PASS | codec, socket и desktop tests |
| G: конкурентный duplicate | PASS | параллельные TLS connections и DB count |
| H: регрессии | PASS | 150 backend integration + общие tests/build |
| XML преподавателя | BLOCKED | файл и XSD не предоставлены |
| Lint | BLOCKED | ни один workspace не содержит lint script/config |
| Ручной интерактивный GUI acceptance | BLOCKED | автоматизированы renderer и desktop main; ручной операторский сеанс не выполнялся |

## 3. Использованные команды

Команды запуска компонентов:

```powershell
npm run dev:backend
npm run dev:hl7-importer
```

Подготовка сертификатов для локального ручного запуска:

```powershell
npm run certs:generate
npm run certs:generate-client -- -ServiceAccountName "Patient Import"
npm run certs:verify
```

Фактически выполненные целевые и общие проверки:

```powershell
npm run test:unit --workspace backend
npm run test --workspace hl7-importer
npm run typecheck --workspace hl7-importer
npm exec --workspace backend -- tsx scripts/run-lab4-stage5-e2e.ts
npm exec --workspace backend -- tsx scripts/run-lab4-stage5-full.ts
npm run test
npm run typecheck
npm run build
git diff --check
```

Два `run-lab4-stage5-*.ts` были одноразовыми безопасными runner-файлами:
создавали уникальные временные DB/role, не печатали пароль и удаляли DB/role в
`finally`. После фактических прогонов runner-файлы удалены и не входят в проект.
Воспроизводимая поддерживаемая команда после ручного создания dedicated test DB
и установки `TEST_DATABASE_URL`/`TEST_DATABASE_CONFIRMATION`:

```powershell
npm run test:integration
```

Итоговые числа:

- migrations: 13/13 на чистой временной DB;
- backend integration: 15 files, 150 tests passed;
- desktop DB E2E: 1 file, 1 test passed;
- общий `npm run test`: frontend 39, backend 47, LIS 21, importer 18 tests passed;
- общий typecheck: 4 workspaces passed;
- общий build: 4 workspaces passed.

Обе временные DB (`medsoft_lab4_stage5_test` и
`medsoft_lab4_stage5_full_test`) и обе non-superuser роли удалены. Development DB
не изменялась.

## 4. Исправленные ошибки

Подтверждённых дефектов рабочего серверного/desktop протокола E2E не обнаружено.
В ходе подготовки validation harness исправлены две тестовые проблемы:

1. Cross-workspace E2E первоначально находился в backend tests и нарушал
   backend `rootDir`. Он перенесён в отдельный integration profile
   `hl7-importer`, для него добавлен отдельный TypeScript config.
2. Первый isolated E2E fixture не создавал администратора ID 1, необходимого
   существующему audit FK при создании service account. Fixture переведён на
   общий `createAuthorizationFixture`, cleanup защищён от частичного `beforeAll`.

Дополнена недостающая проверка expired client certificate, user access JWT,
hostname mismatch, отсутствующего PID и пустого `MSA-2`. Это расширение покрытия,
а не изменение рабочего протокола.

## 5. Неустранённые проблемы

- XML преподавателя отсутствует; демонстрационный формат нельзя объявлять
  совместимым с неизвестным контрактом.
- В проекте нет lint tool/script. Добавление нового линтера не выполнялось,
  поскольку это необязательная инфраструктура вне цели этапа.
- Существующие frontend/Electron builds предупреждают о renderer chunks больше
  500 kB. Builds успешны; оптимизация bundle не относится к HL7 acceptance.
- Windows Electron package не имеет code-signing и отдельной иконки, как уже
  зафиксировано на этапе №4.

## 6. Ограничения среды и непроверенные сценарии

- Не выполнен ручной операторский click-through в видимом Electron окне.
  Renderer behavior покрыт jsdom, main-process transport — реальным TLS/DB E2E,
  production Electron build — сборкой.
- Не выполнена проверка на XML преподавателя из-за отсутствия файла/XSD.
- Не проверялись macOS/Linux packages: поддерживаемая и фактически собранная
  платформа проекта — Windows x64.
- Не выполнялся внешний penetration test. Проверка качества ограничена code
  search, typecheck и существующими security/integration tests.

Статические проверки не нашли committed private keys/real tokens, отключения TLS
verification, логирования secrets, production raw SQL или ручной конкатенации
SQL. Unsafe SQL используется только в защищённых test DB runners для создания
marker/временной инфраструктуры; значения тестовой DB identity предварительно
проверяются guard-механизмом.
