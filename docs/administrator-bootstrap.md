# System administrator bootstrap and TOTP

The system has exactly one administrator stored with the fixed database identifier `1`. It is separate from medical-worker accounts and cannot sign in through `/api/auth/login`.

## Create the one-time bootstrap secret

Before the first setup, run:

```powershell
npm run admin-bootstrap:generate
```

The command prints a cryptographically random 256-bit secret once. Record it securely. Only its SHA-256 hash is stored in the ignored, ACL-protected `certificates\local\admin-bootstrap.sha256` file. Do not put the secret in Git or an `.env` file. The hash file is deleted after successful bootstrap completion.

For an automated environment, `ADMIN_BOOTSTRAP_SECRET_HASH` may contain the lowercase SHA-256 hex digest instead. `ADMIN_BOOTSTRAP_SECRET_HASH_PATH` may override the default hash-file path. Environment variables must be supplied by the deployment secret store, never committed.

## Bootstrap flow

1. `GET /api/admin/bootstrap/status` returns `NOT_CONFIGURED`, `SETUP_IN_PROGRESS`, or `CONFIGURED` without disclosing secrets.
2. `POST /api/admin/bootstrap/start` receives `password` and `passwordConfirmation`. Send the one-time secret in `X-Admin-Bootstrap-Secret`.
3. The successful response contains a Base32 manual secret, an `otpauth://` URI, and a QR-code data URL. This is the only API response that exposes the TOTP secret.
4. Add the account to an authenticator and call `POST /api/admin/bootstrap/complete` with `totpCode` and the same bootstrap header.
5. After a correct code, bootstrap is permanently disabled. There is intentionally no TOTP recovery flow.

TOTP follows RFC 6238 with HMAC-SHA-1, six digits, a 30-second period, and a validation window of one time step in either direction. SHA-1 here is used as the standardized HMAC construction supported by common authenticator applications, not as a certificate or password hash.

## Administrator sessions

- `POST /api/admin/auth/login` always requires both `password` and `totpCode`.
- `POST /api/admin/auth/refresh` and `/logout` use the separate `medsoft_admin_refresh` `Secure`, `HttpOnly`, `SameSite=Strict` cookie and require `X-CSRF-Protection: 1`.
- `GET /api/admin/auth/me` requires the administrator access JWT.

Administrator JWTs use the distinct `admin` subject type and cannot be accepted by medical-worker middleware. Refresh rotation and replay-family revocation are identical in strength to normal account sessions.

Login and bootstrap verification use an in-process limiter. By default five failures within five minutes block attempts for fifteen minutes. The values can be changed with the `ADMIN_LOGIN_*` and `ADMIN_BOOTSTRAP_*` variables shown in `backend/.env.example`. Restarting the single educational backend resets this in-memory limiter.
