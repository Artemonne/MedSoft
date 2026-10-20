# Матрица соответствия ЛР2

Проверка выполнена 20 октября 2026 года на отдельной PostgreSQL-базе
`med_lab2_verify_370553_20261020`. Пользовательская база не изменялась. `PASS` означает проверку
исходного кода и/или автоматический/интеграционный тест; `NOT TESTED` не заменяется предположением.

| Требование | Реализация | Проверка | Статус |
| --- | --- | --- | --- |
| Account: UUID, username 3–16 unique, hash, timestamps, active | `backend/prisma/schema.prisma`, миграция `20261020141814...` | `security-model.test.ts`, Prisma validate, ограничения чистой БД | PASS |
| Опциональная связь account–worker 0..1↔0..1; штатный API требует worker | schema, `schemas/admin-account.ts`, `services/admin-account.ts` | `security-model.test.ts`, `admin-accounts.test.ts` | PASS |
| Роли doctor/laboratory-technician/nurse/other, default other; имя/фамилия от 1 | schema, migration, `schemas/medical-worker.ts` | `core-crud.test.ts`; preservation migration query | PASS |
| Soft-delete деактивирует аккаунт и отзывает активные refresh | `services/medical-worker.ts`, `lib/account-sessions.ts` | `admin-accounts.test.ts` | PASS |
| AuditEvent отделён от MedicalRecordEvent; LR1-история сохранена | schema, migrations, audit/record services | migration preservation scenario, `medical-record*.test.ts` | PASS |
| Единственный администратор и refresh-модель с hash/rotation/revocation | schema, security migration | DB checks, `security-model.test.ts` | PASS |
| Безопасная миграция существующих данных; роль existing worker = other | Prisma migrations | LR1 fixture → все миграции: `1 worker/1 patient/1 record/1 event`, role `other` | PASS |
| Пароли: scrypt, случайная соль, отсутствие plaintext | `lib/password.ts`, Prisma omit | `password.test.ts`, auth/account response tests | PASS |
| Собственный CA и подписанный server cert, ID 370553, O/OU/Issuer/SAN/extensions | `certificates/*.ps1`, `openssl-*.cnf` | `npm run certs:verify`, `openssl verify/x509` | PASS |
| Реальное browser→Vite→API TLS 1.3 без downgrade | `backend/src/server.ts`, `frontend/vite.config.ts` | Node HTTPS к обоим endpoints и `/api/health` через proxy: 200, TLSv1.3, authorized | PASS |
| Нет доверия CA → отказ; TLS 1.2 → отказ | TLS config | Node: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; OpenSSL TLS1.2: protocol version alert | PASS |
| Проверка сертификата нигде не отключена; ключи не в Git/логах | Vite config, `.gitignore`, scripts | source scan; `git ls-files` для `certificates/local` пуст | PASS |
| JWT EdDSA: private sign/public verify, фиксированные alg/iss/aud/type/subject/expiry | `lib/jwt.ts`, auth middleware | `auth.test.ts`, `authorization.test.ts` | PASS |
| Access/refresh конечны; refresh только cookie, CSRF, hash в БД | auth config/cookie/session services | `auth.test.ts`, `security-model.test.ts`, frontend session tests | PASS |
| Парная атомарная refresh-ротация, replay/logout и конкурентный запрос | `services/auth.ts`, `lib/account-sessions.ts` | `auth.test.ts` | PASS |
| Admin bootstrap защищён out-of-band secret и гонками | `lib/bootstrap-secret.ts`, `services/admin-auth.ts` | `admin-auth.test.ts` concurrent bootstrap | PASS |
| QR/manual TOTP, RFC 6238, завершение только после кода, повтор запрещён | `lib/totp.ts`, admin auth controller/service | `totp.test.ts`, `admin-auth.test.ts`, frontend auth tests | PASS |
| Admin login: пароль + TOTP, uniform errors/rate limit/no secret | admin auth + attempt limiter | `admin-auth.test.ts` | PASS |
| Каждый protected endpoint проверен для anonymous/admin/4 ролей | routes/middleware | полный endpoint×actor цикл в `authorization.test.ts` | PASS |
| Деактивированный пользователь и устаревшая роль теряют доступ | middleware читает текущее состояние БД | обход всех user routes в `authorization.test.ts` | PASS |
| Только doctor/nurse создают patient/record; unlock только doctor; все читают | authorization middleware/routes | `authorization.test.ts`, frontend record tests | PASS |
| workerId не принимается; автор берётся из сессии | medical-record schema/controller/service | spoofing + real author tests, frontend request tests | PASS |
| Admin API недоступны worker; admin JWT не принимается user API | separate middleware/subject | endpoint matrix, account/audit tests | PASS |
| Account list/create/password/status/role без раскрытия hash | admin account route/controller/service | `admin-accounts.test.ts`, frontend auth interfaces | PASS |
| Пароль 12 chars, upper/lower/digits, CSPRNG | `services/admin-account.ts` | 100 генераций в `admin-accounts.test.ts` | PASS |
| Изменение password/status/role атомарно отзывает active refresh и считает их | admin account/session/audit services | `admin-accounts.test.ts`, `audit.test.ts` | PASS |
| Централизованный audit всех обязательных событий и четырёх типов actor | `services/audit.ts` и integration hooks | `audit.test.ts` | PASS |
| Аудит append-only/admin-only, без секретов, транзакционный | audit route/service, Prisma omit | authz/immutability/rollback tests in `audit.test.ts` | PASS |
| Аудит: stable order/cursor/no duplicates/≤2 s/error stale | audit API + `frontend/src/api/audit.ts` | backend delivery test и frontend fake-timer polling tests | PASS |
| Отдельные admin/worker layouts, login/bootstrap/account/audit UI | `frontend/src/App.tsx`, auth/layout/pages | `App.test.tsx`, `AuthInterfaces.test.tsx` | PASS |
| Централизованный refresh без localStorage и параллельного шторма | `frontend/src/api/client.ts`, AuthContext | `api-session.test.tsx` | PASS |
| Worker UI использует `/auth/me`, роль и реального worker; manual chooser удалён | AuthContext, WorkerLayout, MedicalRecordPage | `MedicalRecordPage.test.tsx`, source scan | PASS |
| LR1 CRUD, EMR event sourcing, ordering, replay, locks/concurrency | core and medical-record services | `core-crud.test.ts`, `medical-record*.test.ts` | PASS |
| Prisma validate/generate, typecheck, build, all tests | workspace scripts | validate/generate PASS; typecheck PASS; build PASS; frontend 24 + backend 95 PASS | PASS |
| Применение всех миграций на чистой тестовой БД | Prisma migrations | `prisma migrate deploy/status` on dedicated DB | PASS |
| Прямое соответствие исходному «Лабораторная 2.pdf» | PDF отсутствует в workspace и доступных каталогах | поиск PDF по `C:\Users\Artem` | NOT TESTED |

## Зафиксированные результаты TLS

- CA Subject/Issuer: `CN=MedSoft Educational Root CA 370553, OU=MedSoft 2026/27 370553, O=ITMO, C=RU`.
- Server Subject: `CN=localhost, OU=MedSoft 2026/27 370553, O=ITMO, C=RU`.
- Server Issuer совпадает с CA Subject; SAN: `DNS:localhost`, `IP:127.0.0.1`.
- Trusted OpenSSL handshake: TLS 1.3, `TLS_AES_256_GCM_SHA384`, verify code 0.
- Trusted Node HTTPS: backend health 200 и Vite proxy health 200, `authorized=true`.
- Untrusted Node HTTPS: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
- OpenSSL TLS 1.2: отказ с `tlsv1 alert protocol version`.

Windows `curl.exe` данного стенда (Schannel) не смог согласовать TLS 1.3. Это ограничение конкретного
клиента; независимые OpenSSL и Node проверки с обязательной валидацией сертификата прошли.
