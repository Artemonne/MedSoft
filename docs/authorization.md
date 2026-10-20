# Server-side authorization

The API derives the account, medical-worker identifier, and current role from a verified access JWT
and the current database state. Client-supplied role or worker identifiers are never authorization
inputs. Deactivated accounts, deleted workers, and revoked or expired sessions fail with `401`.
Authenticated users without a required role receive `403`.

## Role matrix

| Operation | doctor | nurse | laboratory-technician | other |
| --- | --- | --- | --- | --- |
| View patients, diagnoses, records, and record history | yes | yes | yes | yes |
| Create or update a patient | yes | yes | no | no |
| Create a medical record | yes | yes | no | no |
| Unlock a medical record | yes | no | no | no |
| Change an unlocked record event stream | yes | yes | no | no |
| Change the diagnosis catalog or delete a patient | yes | no | no | no |

Medical records start with `isEditingLocked=true`. A doctor must call
`POST /api/medical-records/:id/unlock` before a doctor or nurse can add, edit, or remove diagnoses and
prescriptions. Event authors are always taken from the authenticated account.

Medical-worker CRUD and account-management routes require an administrator access token. A medical
worker token is not accepted as an administrator token.

Public endpoints are limited to health and authentication/bootstrap flows. Refresh and logout routes
authenticate through their secure refresh cookie and require the existing CSRF header where
applicable.
