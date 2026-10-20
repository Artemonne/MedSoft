# Security audit

`AuditEvent` is the append-only security audit. It is deliberately separate from
`MedicalRecordEvent`, which remains the event-sourced version history of a medical record.

The application creates audit rows through `backend/src/services/audit.ts`. Business changes
that require an audit record use the same Prisma transaction, so an audit write failure rolls
the business change back. The application exposes no update or delete operation for audit rows.

## Actors and data minimization

- `ADMIN` uses the stable system-administrator ID.
- `USER` uses the stable account UUID, not a client-provided worker ID.
- `ANONYMOUS` uses the server-generated request UUID for the individual attempt. This identifies
  the request, not a human; an IP address is not treated as a unique person identifier.
- `SYSTEM` uses an explicit stable operation identifier.

Messages and structured metadata contain only identifiers, operation kinds, and counters. They
must not contain passwords, password hashes, TOTP secrets, JWTs, refresh tokens, cookies, or
clinical record content. The centralized service rejects metadata keys that indicate secrets.

## Administrator API and near-real-time delivery

All endpoints below require a currently valid administrator access token. Authentication is
performed again on every polling request.

- `GET /api/admin/audit?limit=50&before=<cursor>` returns history newest first. Ordering is stable
  by `(occurredAt, id)` and `nextCursor` requests the next page.
- `GET /api/admin/audit/checkpoint` returns the current cursor.
- `GET /api/admin/audit/changes?limit=50&after=<cursor>` returns only newer rows oldest first and
  a cursor for the next request. Responses use `Cache-Control: no-store`.

The reusable client in `frontend/src/api/audit.ts` polls `changes` every 1000 ms and advances only
to the returned `nextCursor`. It obtains the administrator access token again for every request,
so token rotation is respected. This provides delivery within two seconds and prevents duplicates
after reconnecting with the last accepted cursor. If a request fails, the client marks the view as
stale and does not pass previously cached rows to the event callback as if they were current.
