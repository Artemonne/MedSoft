import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    return { plugins: [react()] };
  }

  const certificateDirectory = new URL('../certificates/local/', import.meta.url);
  const ca = readFileSync(fileURLToPath(new URL('ca.cert.pem', certificateDirectory)));
  const cert = readFileSync(fileURLToPath(new URL('server.cert.pem', certificateDirectory)));
  const key = readFileSync(fileURLToPath(new URL('server.key.pem', certificateDirectory)));
  const loggedSockets = new WeakSet<TLSSocket>();

  function logServerCertificate(socket: TLSSocket) {
    if (!socket.authorized || loggedSockets.has(socket)) return;
    const certificate = socket.getPeerCertificate();
    if (!certificate.raw) return;
    loggedSockets.add(socket);
    console.info('[TLS proxy -> https://localhost:3001] Verified server certificate', {
      Subject: certificate.subject,
      Issuer: certificate.issuer,
      'Not Before': certificate.valid_from,
      'Not After': certificate.valid_to,
      'Serial Number': certificate.serialNumber,
      'SHA-256': certificate.fingerprint256,
    });
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      https: {
        key,
        cert,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
      },
      proxy: {
        '/api': {
          target: 'https://localhost:3001',
          changeOrigin: true,
          secure: true,
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              const socket = request.socket;
              if (!(socket instanceof TLSSocket)) return;
              if (socket.authorized) logServerCertificate(socket);
              else socket.once('secureConnect', () => logServerCertificate(socket));
            });
          },
          agent: new Agent({
            ca,
            minVersion: 'TLSv1.3',
            maxVersion: 'TLSv1.3',
            rejectUnauthorized: true,
          }),
        },
      },
    },
  };
});
