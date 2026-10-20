# Medical-worker account management

All routes below require an administrator access token in the `Authorization: Bearer` header.
Ordinary medical-worker JWTs are rejected.

- `GET /api/admin/accounts` lists accounts and linked workers without password hashes or secrets.
- `POST /api/admin/accounts` accepts `username` and `medicalWorkerId`. It returns a generated
  12-character password once, alongside the new account.
- `POST /api/admin/accounts/:id/password` replaces the password and returns it once.
- `PATCH /api/admin/accounts/:id/status` accepts `{ "isActive": boolean }`.
- `PATCH /api/admin/accounts/:id/role` accepts one of `doctor`, `nurse`,
  `laboratory-technician`, or `other`.

Password changes, deactivation, and role changes atomically revoke every unexpired active refresh
session and return `revokedRefreshTokens`, the number of rows actually revoked. Reactivation never
restores old sessions. Soft-deleting a medical worker performs the same deactivation and revocation
inside the worker-deletion transaction.

Account mutations call a transaction-aware audit integration hook. It currently records nothing and
never logs generated passwords; stage 7 can persist the supplied non-secret metadata using the same
database transaction.
