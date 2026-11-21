import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';
import { loadMllpTlsConfiguration } from './config/mllp-tls.js';
import { createHl7MllpServer } from './hl7/server.js';

const port = 3001;
const defaultCertificateDirectory = new URL('../../certificates/local/', import.meta.url);
const keyPath =
  process.env.TLS_SERVER_KEY_PATH ??
  fileURLToPath(new URL('server.key.pem', defaultCertificateDirectory));
const certificatePath =
  process.env.TLS_SERVER_CERT_PATH ??
  fileURLToPath(new URL('server.cert.pem', defaultCertificateDirectory));

const httpsServer = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
  },
  app,
);

httpsServer.listen(port, () => {
  console.log(`Backend listening on https://localhost:${port} (TLS 1.3 only)`);
});

const mllpConfiguration = loadMllpTlsConfiguration();
const mllpServer = createHl7MllpServer(mllpConfiguration);
mllpServer.listen(mllpConfiguration.port, mllpConfiguration.host, () => {
  console.log(`HL7 MLLP listening on ${mllpConfiguration.host}:${mllpConfiguration.port} (mTLS, TLS 1.3 only)`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  httpsServer.close();
  mllpServer.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
