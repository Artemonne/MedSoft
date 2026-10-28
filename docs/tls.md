# Local TLS 1.3 setup

The frontend and API development servers require a local educational CA and a server certificate. Generate them before the first start:

```powershell
npm run certs:generate
```

Enter a CA-key passphrase of at least 12 characters. The script uses ISU ID `370553`, RSA-3072 keys, SHA-384 signatures, and AES-256-CBC encryption for the CA private key. It writes generated material to the ignored `certificates\local` directory and restricts that directory to the current Windows user. Do not copy private keys into the repository or share the CA private key.

To regenerate certificates deliberately:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File certificates\generate-certificates.ps1 -Force
```

Verify the chain, certificate purposes, Subject/Issuer fields, and SAN values:

```powershell
npm run certs:verify
```

## Trust the educational CA on Windows

Install only the public root certificate, never `ca.key.pem` or `server.key.pem`:

```powershell
Import-Certificate `
  -FilePath .\certificates\local\ca.cert.pem `
  -CertStoreLocation Cert:\CurrentUser\Root
```

Confirm the Windows security prompt and restart already-open browsers. The application will then open without an untrusted-certificate warning at both `https://localhost:5173` and `https://localhost:3001`. This CA is educational and must not be used for production systems.

To remove the trust later, open `certmgr.msc`, select **Trusted Root Certification Authorities > Certificates**, find **MedSoft Educational Root CA 370553**, and delete it.

## Start the application

Start both development servers:

```powershell
npm run dev
```

Open <https://localhost:5173>. Vite serves the React application over TLS 1.3 and proxies relative `/api` requests to <https://localhost:3001>.

TLS terminates independently at the Vite development server for the browser connection and at the Express HTTPS server for the API connection. Both endpoints set the minimum and maximum protocol version to TLS 1.3, so TLS 1.2 and older protocols are rejected. The Vite proxy explicitly trusts `certificates\local\ca.cert.pem`, keeps certificate verification enabled, and never downgrades the protected hop to HTTP.

The backend certificate and key default to `certificates\local\server.cert.pem` and `certificates\local\server.key.pem`. The paths can be overridden with `TLS_SERVER_CERT_PATH` and `TLS_SERVER_KEY_PATH` when starting the backend.

## Viewing the certificate for the laboratory demonstration

The React client runs in a browser. Open `https://localhost:5173` and use the
browser's site information / connection security / certificate viewer to inspect
the certificate and its certification path. Trust the educational CA as described
above; do not bypass certificate warnings.

Vite is also a non-browser TLS client when forwarding API requests. After starting
`npm run dev`, open `https://localhost:5173/api/health`. The frontend terminal prints
`[TLS proxy -> https://localhost:3001] Verified server certificate`, followed by
Subject, Issuer, Not Before, Not After, Serial Number and SHA-256 fingerprint.
This information comes from the peer certificate on the actual, successfully
verified proxy TLS socket, once per connection (reused connections do not repeat
the output). It is not read from the backend certificate file. No private keys,
request headers or tokens are logged. Verification of trust and hostname remains
enabled.

The proxy log shows the leaf certificate only. For the full list actually sent
by the backend, add `-showcerts -verify_hostname localhost` to the OpenSSL command
below. A root CA is normally omitted by servers; a browser may complete the path
from its trust store. `npm run certs:verify` checks local files and is not a
substitute for inspecting a live connection.

## Manual connection checks (OpenSSL)

With the servers running, a trusted TLS 1.3 request succeeds:

```powershell
& 'C:\Program Files\Git\usr\bin\openssl.exe' s_client `
  -connect localhost:3001 `
  -servername localhost `
  -CAfile certificates\local\ca.cert.pem `
  -verify_return_error `
  -tls1_3
```

The same command without `-CAfile` must fail certificate verification. A command using `-tls1_2` must fail the protocol negotiation. The health endpoint is available at `https://localhost:3001/api/health`; through the verified Vite proxy it is available at `https://localhost:5173/api/health`.
