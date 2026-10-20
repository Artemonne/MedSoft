# Backend account authentication

## JWT signing keys

Generate a local Ed25519 signing key and its public verification key before using the authentication endpoints:

```powershell
npm run jwt:generate
```

The private key is used only by the JWT signer. Verification imports only `jwt-public.pem`. Both files are created under the ignored `certificates\local` directory, whose ACL is restricted to the current user. The server private key is intentionally unencrypted because the backend must start unattended; its protection depends on the local filesystem ACL. Never commit or share it.

The default key paths can be overridden with `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH`. Token settings are configured with:

```dotenv
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
JWT_ISSUER="medsoft-api"
JWT_AUDIENCE="medsoft-client"
```

## API flow

- `POST /api/auth/login` accepts `username` and `password`, returns a short-lived access token, and sets the refresh token as a `Secure`, `HttpOnly`, `SameSite=Strict` cookie.
- `POST /api/auth/refresh` rotates both tokens. It requires the refresh cookie and the `X-CSRF-Protection: 1` header.
- `POST /api/auth/logout` revokes the refresh family, clears the cookie, and also requires `X-CSRF-Protection: 1`.
- `GET /api/auth/me` requires `Authorization: Bearer <access-token>` and returns the active account and linked medical worker.

The refresh token is never returned in JSON and must not be copied to browser storage. Access and refresh JWTs are EdDSA-signed, have fixed issuer/audience validation, and are bound to a database session. Rotation or logout invalidates the previous access/refresh pair immediately.

Passwords use Node.js `scrypt` with a fresh 128-bit random salt for every hash. Only the encoded KDF parameters, salt, and derived key are stored.
