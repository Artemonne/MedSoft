import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';

const port = 3001;
const defaultCertificateDirectory = new URL('../../certificates/local/', import.meta.url);
const keyPath =
  process.env.TLS_SERVER_KEY_PATH ??
  fileURLToPath(new URL('server.key.pem', defaultCertificateDirectory));
const certificatePath =
  process.env.TLS_SERVER_CERT_PATH ??
  fileURLToPath(new URL('server.cert.pem', defaultCertificateDirectory));

const server = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
  },
  app,
);

server.listen(port, () => {
  console.log(`Backend listening on https://localhost:${port} (TLS 1.3 only)`);
});
