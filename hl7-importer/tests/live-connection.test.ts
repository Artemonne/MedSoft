import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigurationStore } from '../src/main/configuration/store.js';
import { TokenService } from '../src/main/auth/token-service.js';
import { MllpClient } from '../src/main/hl7/mllp-client.js';
import { DemoXmlAdapter } from '../src/main/xml/demo-adapter.js';
import { ImporterService } from '../src/main/importer-service.js';
import { buildConnectionTest } from '../src/main/hl7/codec.js';
import { UnknownOutcomeError } from '../src/main/hl7/mllp-client.js';

function openssl(): string { const git = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'; return existsSync(git) ? git : 'openssl'; }
function run(directory: string, args: string[]) { const result = spawnSync(openssl(), args, { cwd: directory, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); }

describe('desktop client against real HTTPS and mTLS/MLLP test servers', () => {
  let directory: string; let api: HttpsServer; let mllp: TlsServer; let apiPort: number; let mllpPort: number; let mllpMode: 'ack' | 'close' = 'ack';
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'hl7-desktop-live-'));
    writeFileSync(join(directory, 'server.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
    writeFileSync(join(directory, 'client.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n');
    run(directory, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Desktop Test CA', '-addext', 'basicConstraints=critical,CA:true', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', 'ca.key', '-out', 'ca.pem']);
    for (const name of ['server', 'client']) run(directory, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${name === 'server' ? 'localhost' : 'HL7 Desktop Test'}`, '-keyout', `${name}.key`, '-out', `${name}.csr`]);
    for (const name of ['server', 'client']) run(directory, ['x509', '-req', '-days', '2', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-extfile', `${name}.cnf`, '-extensions', 'v3', '-out', `${name}.pem`]);
    const tls = { key: readFileSync(join(directory, 'server.key')), cert: readFileSync(join(directory, 'server.pem')), ca: readFileSync(join(directory, 'ca.pem')), minVersion: 'TLSv1.3' as const, maxVersion: 'TLSv1.3' as const };
    api = createHttpsServer(tls, (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/service-auth/token') response.end(JSON.stringify({ accessToken: 'header.payload.signature', refreshToken: 'refresh-token', tokenType: 'Bearer', expiresIn: 900 }));
      else if (request.url === '/api/testConnection' && request.headers.authorization === 'Bearer header.payload.signature') response.end(JSON.stringify({ status: 'connected', role: 'HL7_IMPORT' }));
      else { response.statusCode = 401; response.end(JSON.stringify({ error: { message: 'Unauthorized' } })); }
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve)); apiPort = (api.address() as any).port;
    mllp = createTlsServer({ ...tls, requestCert: true, rejectUnauthorized: true }, (socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]); const end = buffer.indexOf(0x1c); if (end < 0) return;
        if (mllpMode === 'close') { socket.end(); return; }
        const payload = buffer.subarray(1, end).toString('utf8'); const controlId = payload.split('\r')[0]!.split('|')[9];
        const ack = `MSH|^~\\&|MEDSOFT-HIS|HIS|IMPORTER|SOURCE|20261122000000||ACK^Q11^ACK|ack|P|2.8\rMSA|AA|${controlId}|Connection successful.\r`;
        socket.end(Buffer.concat([Buffer.from([0x0b]), Buffer.from(ack), Buffer.from([0x1c, 0x0d])]));
      });
    });
    await new Promise<void>((resolve) => mllp.listen(0, '127.0.0.1', resolve)); mllpPort = (mllp.address() as any).port;
  }, 30_000);
  afterAll(async () => {
    await Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => mllp.close(() => resolve()))]);
    rmSync(directory, { recursive: true, force: true });
  });

  it('performs token exchange, HTTP check, verified TLS handshake, QBP and correlated ACK', async () => {
    const secrets = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (value: Uint8Array) => Buffer.from(value).toString() };
    const store = new ConfigurationStore(join(directory, 'settings.json'), secrets);
    const service = new ImporterService(store, new TokenService(store), new MllpClient(), new DemoXmlAdapter());
    const result = await service.testConnection({
      hisUrl: `https://127.0.0.1:${apiPort}`, mllpHost: '127.0.0.1', mllpPort, tlsServerName: 'localhost', sourceSystemId: 'DESKTOP-TEST', apiKey: 'msk_abcdefghijklmnopqrstuvwxyz',
      clientCertificatePath: join(directory, 'client.pem'), clientKeyPath: join(directory, 'client.key'), caCertificatePath: join(directory, 'ca.pem'), timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.api.ok).toBe(true);
    expect(result.mllp.ok).toBe(true);
    expect(result.certificate).toMatchObject({ commonName: 'localhost', authorized: true });
  });

  it('rejects an untrusted server certificate and treats a missing ACK as unknown', async () => {
    const client = new MllpClient();
    const base = {
      hisUrl: `https://127.0.0.1:${apiPort}`, mllpHost: '127.0.0.1', mllpPort, tlsServerName: 'localhost', sourceSystemId: 'DESKTOP-TEST',
      clientCertificatePath: join(directory, 'client.pem'), clientKeyPath: join(directory, 'client.key'), caCertificatePath: join(directory, 'ca.pem'), timeoutMs: 2_000,
    };
    const message = buildConnectionTest('DESKTOP-TEST', 'header.payload.signature');
    await expect(client.exchange({ ...base, caCertificatePath: join(directory, 'client.pem') }, message.payload)).rejects.toThrow(/доверенным центром|TLS/);
    await expect(client.exchange({ ...base, tlsServerName: 'wrong-host.test' }, message.payload)).rejects.toThrow(/TLS|сертификат/);
    mllpMode = 'close';
    await expect(client.exchange(base, message.payload)).rejects.toBeInstanceOf(UnknownOutcomeError);
    mllpMode = 'ack';
  });
});
