import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';
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
