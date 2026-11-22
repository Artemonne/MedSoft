import { randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../backend/src/app.js';
import { createHl7MllpServer } from '../../backend/src/hl7/server.js';
import { prisma } from '../../backend/src/lib/prisma.js';
import { serviceAccountService } from '../../backend/src/services/service-account.js';
import { createAuthorizationFixture } from '../../backend/tests/helpers/auth-fixture.js';
import { ConfigurationStore } from '../src/main/configuration/store.js';
import { TokenService } from '../src/main/auth/token-service.js';
import { MllpClient } from '../src/main/hl7/mllp-client.js';
import { DemoXmlAdapter } from '../src/main/xml/demo-adapter.js';
import { ImporterService } from '../src/main/importer-service.js';

function openssl(): string { const git = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'; return existsSync(git) ? git : 'openssl'; }
function runOpenSsl(directory: string, args: string[]) { const result = spawnSync(openssl(), args, { cwd: directory, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); }
function code(): string { return randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(); }
function xml(patients: string): Buffer { return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><medsoft-demo-patients>${patients}</medsoft-demo-patients>`); }
function patient(externalId: string, firstName: string, diagnoses: Array<{ code: string; name: string }>) {
  return `<patient externalId="${externalId}"><firstName>${firstName}</firstName><lastName>Тестовый</lastName><birthDate>1990-01-02</birthDate><sex>UNKNOWN</sex><diagnoses>${diagnoses.map((item) => `<diagnosis code="${item.code}" name="${item.name}" />`).join('')}</diagnoses></patient>`;
}

describe('desktop → API → mTLS/MLLP → HIS → database → ACK → desktop', () => {
  let directory: string; let httpsServer: HttpsServer; let mllpServer: ReturnType<typeof createHl7MllpServer>;
  let httpsPort: number; let mllpPort: number; let serviceId = ''; let serviceApiKey = ''; let source = '';
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>> | undefined;
  const diagnosisCodes = new Set<string>();

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'medsoft-desktop-e2e-'));
    writeFileSync(join(directory, 'server.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
    writeFileSync(join(directory, 'client.cnf'), '[v3]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n');
    runOpenSsl(directory, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=Desktop E2E CA', '-addext', 'basicConstraints=critical,CA:true', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', 'ca.key', '-out', 'ca.pem']);
    for (const name of ['server', 'client']) runOpenSsl(directory, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', `/CN=${name === 'server' ? 'localhost' : 'Desktop E2E Import'}`, '-keyout', `${name}.key`, '-out', `${name}.csr`]);
    for (const name of ['server', 'client']) runOpenSsl(directory, ['x509', '-req', '-sha256', '-days', '2', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-extfile', `${name}.cnf`, '-extensions', 'v3', '-out', `${name}.pem`]);
    const tls = { key: readFileSync(join(directory, 'server.key')), cert: readFileSync(join(directory, 'server.pem')), minVersion: 'TLSv1.3' as const, maxVersion: 'TLSv1.3' as const };
    httpsServer = createHttpsServer(tls, app);
    await new Promise<void>((resolve) => httpsServer.listen(0, '127.0.0.1', resolve)); httpsPort = (httpsServer.address() as any).port;
    mllpServer = createHl7MllpServer({ host: '127.0.0.1', port: 0, maxMessageBytes: 102_400, idleTimeoutMs: 3_000, tls: { ...tls, ca: [readFileSync(join(directory, 'ca.pem'))], requestCert: true, rejectUnauthorized: true } });
    await new Promise<void>((resolve) => mllpServer.listen(0, '127.0.0.1', resolve)); mllpPort = (mllpServer.address() as any).port;
    fixture = await createAuthorizationFixture([], true);
    const account = await serviceAccountService.create({ name: `Desktop E2E ${randomUUID()}`, role: 'HL7_IMPORT' }, 1);
    serviceId = account.account.id; serviceApiKey = account.apiKey; source = `E2E-${randomUUID().slice(0, 8)}`;
  }, 30_000);

  afterAll(async () => {
    await Promise.all([new Promise<void>((resolve) => httpsServer?.close(() => resolve())), new Promise<void>((resolve) => mllpServer?.close(() => resolve()))]);
    const patients = await prisma.patient.findMany({ where: { externalIdSource: source }, select: { id: true, medicalRecord: { select: { id: true } } } });
    const recordIds = patients.flatMap((item) => item.medicalRecord ? [item.medicalRecord.id] : []);
    await prisma.medicalRecordEvent.deleteMany({ where: { medicalRecordId: { in: recordIds } } });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patients.map((item) => item.id) } } });
    await prisma.diagnosis.deleteMany({ where: { code: { in: [...diagnosisCodes] } } });
    if (serviceId) {
      await prisma.refreshSession.deleteMany({ where: { serviceAccountId: serviceId } });
      await prisma.auditEvent.deleteMany({ where: { serviceAccountId: serviceId } });
      await prisma.serviceAccount.deleteMany({ where: { id: serviceId } });
    }
    await fixture?.cleanup();
    if (directory) rmSync(directory, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('imports, rejects duplicates without side effects, and rolls back one patient independently', async () => {
    const secrets = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (value: Uint8Array) => Buffer.from(value).toString() };
    const store = new ConfigurationStore(join(directory, 'settings.json'), secrets);
    const desktop = new ImporterService(store, new TokenService(store), new MllpClient(), new DemoXmlAdapter());
    const settings = { hisUrl: `https://127.0.0.1:${httpsPort}`, mllpHost: '127.0.0.1', mllpPort, tlsServerName: 'localhost', sourceSystemId: source, apiKey: serviceApiKey, clientCertificatePath: join(directory, 'client.pem'), clientKeyPath: join(directory, 'client.key'), caCertificatePath: join(directory, 'ca.pem'), timeoutMs: 5_000 };
    const connection = await desktop.testConnection(settings);
    expect(connection).toMatchObject({ ok: true, api: { ok: true }, mllp: { ok: true }, certificate: { commonName: 'localhost', authorized: true } });

    const firstCodes = [code(), code()]; firstCodes.forEach((item) => diagnosisCodes.add(item));
    desktop.loadXml(xml(patient('POSITIVE-1', 'Алиса', [{ code: firstCodes[0], name: 'Первый синтетический диагноз' }]) + patient('POSITIVE-2', 'Борис', [{ code: firstCodes[1], name: 'Второй синтетический диагноз' }])), 'positive.xml');
    const positive = await desktop.importPatients(() => {});
    expect(positive.map((item) => item.status)).toEqual(['SUCCESS', 'SUCCESS']);
    expect(positive.every((item) => /^\d+$/.test(item.hisPatientId ?? ''))).toBe(true);
    const saved = await prisma.patient.findMany({ where: { externalIdSource: source, externalIdValue: { in: ['POSITIVE-1', 'POSITIVE-2'] } }, include: { medicalRecord: { include: { events: true } } }, orderBy: { externalIdValue: 'asc' } });
    expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({ firstName: 'Алиса', lastName: 'Тестовый' });
    expect(saved.every((item) => item.medicalRecord?.events.length === 1)).toBe(true);
    expect(await prisma.diagnosis.count({ where: { code: { in: firstCodes } } })).toBe(2);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { serviceAccountId: serviceId, eventType: 'HL7_PATIENT_IMPORTED' }, orderBy: { occurredAt: 'desc' } });
    expect((audit.metadata as any).certificate.fingerprintSha256).toBe(new X509Certificate(readFileSync(join(directory, 'client.pem'))).fingerprint256);

    const before = saved[0]!; const rejectedCode = code(); diagnosisCodes.add(rejectedCode);
    desktop.loadXml(xml(patient('POSITIVE-1', 'ИзменённоеИмя', [{ code: rejectedCode, name: 'Не должен сохраниться' }])), 'duplicate.xml');
    const duplicate = await desktop.importPatients(() => {});
    expect(duplicate[0]).toMatchObject({ status: 'REJECTED', hisPatientId: null });
    expect(duplicate[0]?.message).toContain('already exists');
    expect(await prisma.patient.count({ where: { externalIdSource: source } })).toBe(2);
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ firstName: before.firstName, updatedAt: before.updatedAt });
    expect(await prisma.diagnosis.findUnique({ where: { code: rejectedCode } })).toBeNull();

    const conflictName = `Conflict ${randomUUID()}`; const existingCode = code(); const rolledBackCode = code(); const conflictingCode = code(); const independentCode = code();
    [existingCode, rolledBackCode, conflictingCode, independentCode].forEach((item) => diagnosisCodes.add(item));
    await prisma.diagnosis.create({ data: { code: existingCode, name: conflictName } });
    desktop.loadXml(xml(
      patient('ROLLBACK-1', 'Ошибка', [{ code: rolledBackCode, name: 'Создаётся до ошибки' }, { code: conflictingCode, name: conflictName }]) +
      patient('INDEPENDENT-1', 'Успех', [{ code: independentCode, name: 'Независимый диагноз' }]),
    ), 'atomicity.xml');
    const atomicity = await desktop.importPatients(() => {});
    expect(atomicity.map((item) => item.status)).toEqual(['REJECTED', 'SUCCESS']);
    expect(await prisma.patient.findUnique({ where: { externalIdSource_externalIdValue: { externalIdSource: source, externalIdValue: 'ROLLBACK-1' } } })).toBeNull();
    expect(await prisma.diagnosis.findUnique({ where: { code: rolledBackCode } })).toBeNull();
    expect(await prisma.diagnosis.findUnique({ where: { code: conflictingCode } })).toBeNull();
    expect(await prisma.patient.findUnique({ where: { externalIdSource_externalIdValue: { externalIdSource: source, externalIdValue: 'INDEPENDENT-1' } } })).not.toBeNull();
    expect(await prisma.diagnosis.findUnique({ where: { code: independentCode } })).not.toBeNull();
  });
});
