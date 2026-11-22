import { randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect as connectTls } from 'node:tls';
import { MedicalWorkerRole, ServiceAccountRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHl7MllpServer } from '../src/hl7/server.js';
import { frameMllp, MllpDecoder } from '../src/hl7/mllp.js';
import { prisma } from '../src/lib/prisma.js';
import { issueTokenPair } from '../src/lib/jwt.js';
import { serviceAccountService } from '../src/services/service-account.js';
import { serviceAuthService } from '../src/services/service-auth.js';
import { createAuthorizationFixture } from './helpers/auth-fixture.js';

interface Certificates {
  directory: string;
  ca: Buffer;
  serverKey: Buffer;
  serverCertificate: Buffer;
  clientKey: Buffer;
  clientCertificate: Buffer;
  untrustedKey: Buffer;
  untrustedCertificate: Buffer;
  expiredKey: Buffer;
  expiredCertificate: Buffer;
}

function openssl(): string {
  const gitOpenSsl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  return existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl';
}

function runOpenSsl(directory: string, args: string[]) {
  const result = spawnSync(openssl(), args, { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`OpenSSL failed: ${result.stderr || result.stdout}`);
}

function generateCertificates(): Certificates {
  const directory = mkdtempSync(join(tmpdir(), 'medsoft-hl7-tls-'));
  writeFileSync(join(directory, 'server.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
  writeFileSync(join(directory, 'client.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n');
  runOpenSsl(directory, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=MedSoft Test CA', '-addext', 'basicConstraints=critical,CA:true', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', 'ca.key.pem', '-out', 'ca.cert.pem']);
  runOpenSsl(directory, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=localhost', '-keyout', 'server.key.pem', '-out', 'server.csr.pem']);
  runOpenSsl(directory, ['x509', '-req', '-sha256', '-days', '2', '-in', 'server.csr.pem', '-CA', 'ca.cert.pem', '-CAkey', 'ca.key.pem', '-CAcreateserial', '-extfile', 'server.cnf', '-extensions', 'v3', '-out', 'server.cert.pem']);
  runOpenSsl(directory, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=HL7 Integration Test', '-keyout', 'client.key.pem', '-out', 'client.csr.pem']);
  runOpenSsl(directory, ['x509', '-req', '-sha256', '-days', '2', '-in', 'client.csr.pem', '-CA', 'ca.cert.pem', '-CAkey', 'ca.key.pem', '-CAcreateserial', '-extfile', 'client.cnf', '-extensions', 'v3', '-out', 'client.cert.pem']);
  runOpenSsl(directory, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=Untrusted Client', '-addext', 'basicConstraints=critical,CA:false', '-addext', 'extendedKeyUsage=clientAuth', '-keyout', 'untrusted.key.pem', '-out', 'untrusted.cert.pem']);
  runOpenSsl(directory, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=Expired Client', '-keyout', 'expired.key.pem', '-out', 'expired.csr.pem']);
  runOpenSsl(directory, ['x509', '-req', '-sha256', '-days', '0', '-in', 'expired.csr.pem', '-CA', 'ca.cert.pem', '-CAkey', 'ca.key.pem', '-CAcreateserial', '-extfile', 'client.cnf', '-extensions', 'v3', '-out', 'expired.cert.pem']);
  return {
    directory,
    ca: readFileSync(join(directory, 'ca.cert.pem')),
    serverKey: readFileSync(join(directory, 'server.key.pem')),
    serverCertificate: readFileSync(join(directory, 'server.cert.pem')),
    clientKey: readFileSync(join(directory, 'client.key.pem')),
    clientCertificate: readFileSync(join(directory, 'client.cert.pem')),
    untrustedKey: readFileSync(join(directory, 'untrusted.key.pem')),
    untrustedCertificate: readFileSync(join(directory, 'untrusted.cert.pem')),
    expiredKey: readFileSync(join(directory, 'expired.key.pem')),
    expiredCertificate: readFileSync(join(directory, 'expired.cert.pem')),
  };
}

function msh(type: string, controlId: string) {
  return `MSH|^~\\&|HL7-TEST|TEST-SOURCE|MEDSOFT-HIS|HIS|20261121200000||${type}|${controlId}|P|2.8`;
}

function uac(token: string) {
  return `UAC|JWT^JSON Web Token^99MEDSOFT|MEDSOFT-HL7-IMPORTER^AP^jwt^A^${token}`;
}

function adt(token: string, externalId: string, controlId: string, diagnoses: Array<{ code: string; name?: string }> = []) {
  return [
    msh('ADT^A28^ADT_A05', controlId),
    uac(token),
    `PID|||${externalId}^^^TEST-SOURCE^PI||Testov^Patient^Integration||20000102|U`,
    ...diagnoses.map((item, index) => `DG1|${index + 1}||${item.code}^${item.name ?? ''}^99MEDSOFT-DIAGNOSIS`),
  ].join('\r') + '\r';
}

function connectionTest(token: string, controlId: string) {
  return [msh('QBP^Q11^QBP_Q11', controlId), uac(token), 'QPD|MEDSOFT_CONNECTION_TEST^Connection Test^99MEDSOFT|query-1', 'RCP|I'].join('\r') + '\r';
}

function msa(ack: string) {
  const segment = ack.split('\r').find((item) => item.startsWith('MSA|'))!;
  const fields = segment.split('|');
  return { code: fields[1], controlId: fields[2], text: fields[3] };
}

describe('HL7 MLLP mTLS integration', () => {
  let certificates: Certificates;
  let server: ReturnType<typeof createHl7MllpServer>;
  let port: number;
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let serviceId: string;
  let lisServiceId: string;
  let accessToken: string;
  let lisAccessToken: string;
  let userAccessToken: string;
  const sources = ['TEST-SOURCE'];
  const diagnosisCodes = new Set<string>();

  beforeAll(async () => {
    certificates = generateCertificates();
    fixture = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR], true);
    userAccessToken = fixture.users.get(MedicalWorkerRole.DOCTOR)!.accessToken;
    const service = await serviceAccountService.create({ name: `HL7 Test ${randomUUID()}`, role: ServiceAccountRole.HL7_IMPORT }, 1);
    serviceId = service.account.id;
    accessToken = (await serviceAuthService.exchangeApiKey(service.apiKey, randomUUID())).accessToken;
    const lis = await serviceAccountService.create({ name: `LIS Wrong Role ${randomUUID()}`, role: ServiceAccountRole.LIS }, 1);
    lisServiceId = lis.account.id;
    lisAccessToken = (await serviceAuthService.exchangeApiKey(lis.apiKey, randomUUID())).accessToken;
    server = createHl7MllpServer({
      host: '127.0.0.1', port: 0, maxMessageBytes: 102_400, idleTimeoutMs: 2_000,
      tls: { key: certificates.serverKey, cert: certificates.serverCertificate, ca: [certificates.ca], requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('MLLP server did not bind.');
    port = address.port;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const patients = await prisma.patient.findMany({ where: { externalIdSource: { in: sources } }, select: { id: true, medicalRecord: { select: { id: true } } } });
    const recordIds = patients.flatMap((item) => item.medicalRecord ? [item.medicalRecord.id] : []);
    await prisma.medicalRecordEvent.deleteMany({ where: { medicalRecordId: { in: recordIds } } });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patients.map((item) => item.id) } } });
    await prisma.diagnosis.deleteMany({ where: { code: { in: [...diagnosisCodes] } } });
    await prisma.refreshSession.deleteMany({ where: { serviceAccountId: { in: [serviceId, lisServiceId] } } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ serviceAccountId: { in: [serviceId, lisServiceId] } }, { eventType: { startsWith: 'HL7_' } }] } });
    await prisma.serviceAccount.deleteMany({ where: { id: { in: [serviceId, lisServiceId] } } });
    await fixture?.cleanup();
    if (certificates?.directory) rmSync(certificates.directory, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  async function exchange(payloads: string[], options?: { split?: boolean; certificate?: 'trusted' | 'untrusted' | 'expired' | 'none' }): Promise<string[]> {
    const certificate = options?.certificate ?? 'trusted';
    return new Promise((resolve, reject) => {
      const socket = connectTls({
        host: '127.0.0.1', port, servername: 'localhost', ca: certificates.ca, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
        ...(certificate === 'trusted' ? { key: certificates.clientKey, cert: certificates.clientCertificate } : certificate === 'untrusted' ? { key: certificates.untrustedKey, cert: certificates.untrustedCertificate } : certificate === 'expired' ? { key: certificates.expiredKey, cert: certificates.expiredCertificate } : {}),
      });
      const decoder = new MllpDecoder(102_400);
      const responses: string[] = [];
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Timed out waiting for HL7 ACK.')); }, 5_000);
      socket.once('error', (error) => { clearTimeout(timeout); reject(error); });
      socket.once('close', () => {
        clearTimeout(timeout);
        if (responses.length < payloads.length) reject(new Error('TLS connection closed before all HL7 ACK messages were received.'));
      });
      socket.on('data', (chunk) => {
        for (const event of decoder.push(chunk)) {
          if (event.type === 'error') { clearTimeout(timeout); socket.destroy(); reject(new Error(event.message)); return; }
          responses.push(event.payload.toString('utf8'));
          if (responses.length === payloads.length) { clearTimeout(timeout); socket.end(); resolve(responses); }
        }
      });
      socket.once('secureConnect', () => {
        const frames = Buffer.concat(payloads.map(frameMllp));
        if (options?.split) {
          socket.write(frames.subarray(0, 7));
          socket.write(frames.subarray(7, 31));
          socket.write(frames.subarray(31));
        } else {
          socket.write(frames);
        }
      });
    });
  }

  async function expectTlsRejection(certificate: 'untrusted' | 'expired' | 'none') {
    await expect(exchange([connectionTest(accessToken, randomUUID())], { certificate })).rejects.toThrow();
  }

  function code(): string {
    const value = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
    diagnosisCodes.add(value);
    return value;
  }

  it('imports ADT A28 atomically with diagnoses and certificate audit identity', async () => {
    const externalId = `success-${randomUUID()}`;
    const controlId = randomUUID();
    const codes = [code(), code()];
    const [ack] = await exchange([adt(accessToken, externalId, controlId, [{ code: codes[0], name: 'First imported diagnosis' }, { code: codes[1], name: 'Second imported diagnosis' }])], { split: true });
    const result = msa(ack);
    expect(result).toMatchObject({ code: 'AA', controlId });
    expect(Number(result.text)).toBeGreaterThan(0);
    const patient = await prisma.patient.findUniqueOrThrow({ where: { externalIdSource_externalIdValue: { externalIdSource: 'TEST-SOURCE', externalIdValue: externalId } }, include: { medicalRecord: { include: { events: true } } } });
    expect(patient.id).toBe(Number(result.text));
    expect(patient.medicalRecord?.events).toHaveLength(2);
    expect(patient.medicalRecord?.events.every((event) => event.workerId === null && event.serviceAccountId === serviceId)).toBe(true);
    expect(await prisma.diagnosis.count({ where: { code: { in: codes } } })).toBe(2);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: 'HL7_PATIENT_IMPORTED', serviceAccountId: serviceId }, orderBy: { occurredAt: 'desc' } });
    const metadata = audit.metadata as any;
    expect(metadata).toMatchObject({ messageControlId: controlId, result: 'SUCCESS', patientId: patient.id });
    expect(metadata.certificate.fingerprintSha256).toBe(new X509Certificate(certificates.clientCertificate).fingerprint256);
    expect(metadata.certificate.subject).toContain('CN=HL7 Integration Test');
  });

  it('rejects a duplicate without changing patient or diagnoses', async () => {
    const externalId = `duplicate-${randomUUID()}`;
    const firstCode = code();
    expect(msa((await exchange([adt(accessToken, externalId, randomUUID(), [{ code: firstCode, name: 'Original diagnosis' }])]))[0]).code).toBe('AA');
    const before = await prisma.patient.findUniqueOrThrow({ where: { externalIdSource_externalIdValue: { externalIdSource: 'TEST-SOURCE', externalIdValue: externalId } } });
    const secondCode = code();
    const duplicate = msa((await exchange([adt(accessToken, externalId, 'duplicate-control', [{ code: secondCode, name: 'Must roll back' }])]))[0]);
    expect(duplicate).toMatchObject({ code: 'AE', controlId: 'duplicate-control' });
    expect(duplicate.text).toContain('already exists');
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ firstName: before.firstName, updatedAt: before.updatedAt });
    expect(await prisma.diagnosis.findUnique({ where: { code: secondCode } })).toBeNull();
  });

  it('rolls back a patient and prior writes when a later diagnosis is invalid', async () => {
    const externalId = `rollback-${randomUUID()}`;
    const validCode = code();
    const missingNameCode = code();
    const result = msa((await exchange([adt(accessToken, externalId, 'rollback-control', [{ code: validCode, name: 'Created before failure' }, { code: missingNameCode }])]))[0]);
    expect(result.code).toBe('AE');
    expect(result.text).toContain('requires a name');
    expect(await prisma.patient.findUnique({ where: { externalIdSource_externalIdValue: { externalIdSource: 'TEST-SOURCE', externalIdValue: externalId } } })).toBeNull();
    expect(await prisma.diagnosis.count({ where: { code: { in: [validCode, missingNameCode] } } })).toBe(0);
  });

  it('authenticates the connection test and creates no patient', async () => {
    const before = await prisma.patient.count({ where: { externalIdSource: 'TEST-SOURCE' } });
    const controlId = 'connection-control';
    expect(msa((await exchange([connectionTest(accessToken, controlId)]))[0])).toEqual({ code: 'AA', controlId, text: 'Connection successful.' });
    expect(await prisma.patient.count({ where: { externalIdSource: 'TEST-SOURCE' } })).toBe(before);
  });

  it('rejects malformed, expired and wrong-role JWT credentials', async () => {
    const issuedAt = new Date(Date.now() - 60 * 60 * 1000);
    const expired = await issueTokenPair({ subjectId: serviceId, subjectType: 'service', serviceRole: ServiceAccountRole.HL7_IMPORT, sessionId: randomUUID(), issuedAt });
    const messages = [
      adt('header.payload.signature', `invalid-${randomUUID()}`, 'invalid-jwt'),
      adt(expired.accessToken, `expired-${randomUUID()}`, 'expired-jwt'),
      adt(lisAccessToken, `wrong-role-${randomUUID()}`, 'wrong-role'),
      adt(userAccessToken, `user-token-${randomUUID()}`, 'user-token'),
    ];
    const results = (await exchange(messages)).map(msa);
    expect(results.map((item) => item.code)).toEqual(['AE', 'AE', 'AE', 'AE']);
    expect(results.map((item) => item.controlId)).toEqual(['invalid-jwt', 'expired-jwt', 'wrong-role', 'user-token']);
    expect(results[2].text).toContain('HL7 Import role');
  });

  it('handles two independent patients in one connection', async () => {
    const ids = [`batch-${randomUUID()}`, `batch-${randomUUID()}`];
    const responses = await exchange(ids.map((id, index) => adt(accessToken, id, `batch-${index}`)));
    expect(responses.map((ack) => msa(ack).code)).toEqual(['AA', 'AA']);
    expect(await prisma.patient.count({ where: { externalIdSource: 'TEST-SOURCE', externalIdValue: { in: ids } } })).toBe(2);
  });

  it('commits a valid patient after an earlier patient fails on the same connection', async () => {
    const invalidId = `mixed-invalid-${randomUUID()}`;
    const validId = `mixed-valid-${randomUUID()}`;
    const invalidCode = code();
    const responses = await exchange([
      adt(accessToken, invalidId, 'mixed-invalid', [{ code: invalidCode }]),
      adt(accessToken, validId, 'mixed-valid'),
    ]);
    expect(responses.map((ack) => msa(ack).code)).toEqual(['AE', 'AA']);
    expect(await prisma.patient.findUnique({ where: { externalIdSource_externalIdValue: { externalIdSource: 'TEST-SOURCE', externalIdValue: invalidId } } })).toBeNull();
    expect(await prisma.patient.findUnique({ where: { externalIdSource_externalIdValue: { externalIdSource: 'TEST-SOURCE', externalIdValue: validId } } })).not.toBeNull();
  });

  it('uses the database unique constraint to serialize concurrent duplicate imports', async () => {
    const externalId = `parallel-${randomUUID()}`;
    const [first, second] = await Promise.all([
      exchange([adt(accessToken, externalId, 'parallel-one')]),
      exchange([adt(accessToken, externalId, 'parallel-two')]),
    ]);
    expect([msa(first[0]).code, msa(second[0]).code].sort()).toEqual(['AA', 'AE']);
    expect(await prisma.patient.count({ where: { externalIdSource: 'TEST-SOURCE', externalIdValue: externalId } })).toBe(1);
  });

  it('rejects missing and untrusted client certificates before HL7 processing', async () => {
    await expectTlsRejection('none');
    await expectTlsRejection('untrusted');
    await expectTlsRejection('expired');
  });

  it('closes a malformed frame but remains available for a new connection', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = connectTls({ host: '127.0.0.1', port, servername: 'localhost', ca: certificates.ca, key: certificates.clientKey, cert: certificates.clientCertificate, rejectUnauthorized: true, minVersion: 'TLSv1.3' });
      const timeout = setTimeout(() => reject(new Error('Malformed frame connection was not closed.')), 5_000);
      socket.once('error', () => { clearTimeout(timeout); resolve(); });
      socket.once('close', () => { clearTimeout(timeout); resolve(); });
      socket.once('secureConnect', () => socket.write(Buffer.from('not-an-mllp-frame')));
    });
    expect(msa((await exchange([connectionTest(accessToken, 'after-malformed')]))[0]).code).toBe('AA');
  });
});
