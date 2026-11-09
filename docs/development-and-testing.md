# MedSoft development and test database setup

## Prerequisites and installation

Use Node.js 20.19 or newer, npm 10 or newer, PostgreSQL, and PowerShell. Install the workspace dependencies from the repository root:

```powershell
npm install
```

The HIS development database is configured only in the ignored `backend/.env` file. Copy `backend/.env.example` and replace the example credentials locally. Never commit that file or print its values in logs.

## Prisma

Validate the source schema and regenerate the local client after installing dependencies or changing `backend/prisma/schema.prisma`:

```powershell
npm run prisma:validate
npm run prisma:generate
```

Apply existing migrations to the development database without resetting it:

```powershell
npm exec --workspace backend -- prisma migrate deploy
```

Do not use `prisma migrate reset` against an existing database. Check the target and migration state first with `prisma migrate status`.

## Dedicated integration database

Integration tests modify and delete rows, including audit rows and the singleton administrator. They cannot use `DATABASE_URL`. Create a separate database and a separate non-superuser role. The database name must contain `test` as a separate segment, for example `medsoft_test`.

Run the following SQL as a PostgreSQL administrator, substituting a locally generated password:

```sql
CREATE ROLE his_test_user LOGIN PASSWORD '<local-secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE medsoft_test OWNER his_test_user;
```

Set the test connection only in the shell that runs the tests. The confirmation contains no password and must exactly match the database and role parsed from the URL:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://his_test_user:<local-secret>@localhost:5432/medsoft_test?schema=public'
$env:TEST_DATABASE_CONFIRMATION = 'medsoft_test/his_test_user'
npm run test:integration
```

The integration runner performs all of these checks before tests can change data:

- requires the dedicated test variable and explicit database/user confirmation;
- rejects development database names and the configured development target;
- verifies `current_database()` and `current_user` on the PostgreSQL server;
- rejects PostgreSQL superusers;
- applies committed migrations to the test database;
- writes and then verifies a database-local MedSoft test marker;
- runs the database-changing test files sequentially.

Direct invocation of the integration Vitest configuration still verifies the marker and connection identity. The default backend test configuration contains only tests that do not persistently modify database data.

Remove both test variables from the shell when finished:

```powershell
Remove-Item Env:TEST_DATABASE_URL
Remove-Item Env:TEST_DATABASE_CONFIRMATION
```

## Verification commands

Safe checks that do not require the integration database:

```powershell
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run test:unit
npm run build
```

The same sequence is available as:

```powershell
npm run check
```

Run database integration tests separately after configuring the dedicated database:

```powershell
npm run test:integration
```

The root `npm test` command runs backend unit tests and frontend tests. It intentionally does not start database integration tests.

## Environment variables

Development backend variables, without values:

- `DATABASE_URL`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH` when default local paths are not used
- `TLS_SERVER_CERT_PATH` and `TLS_SERVER_KEY_PATH` when default local paths are not used
- `ADMIN_BOOTSTRAP_SECRET_HASH` or `ADMIN_BOOTSTRAP_SECRET_HASH_PATH`
- `ADMIN_LOGIN_MAX_ATTEMPTS`, `ADMIN_LOGIN_WINDOW_SECONDS`, `ADMIN_LOGIN_BLOCK_SECONDS`
- `ADMIN_BOOTSTRAP_MAX_ATTEMPTS`, `ADMIN_BOOTSTRAP_WINDOW_SECONDS`, `ADMIN_BOOTSTRAP_BLOCK_SECONDS`

Integration-only variables:

- `TEST_DATABASE_URL`
- `TEST_DATABASE_CONFIRMATION`
