import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MedicalWorkerRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createAuthorizationFixture } from './helpers/auth-fixture.js';

describe('live HTTPS HIS to LIS main-process integration', () => {
  let server: Server; let baseUrl: string; let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let serviceId: string; let patientId: number; let recordId: number; let textTestId: number; let quantityTestId: number;
  let textOrderId: string; let quantityOrderId: string; let directory: string; let databasePath: string; let database: any; let serviceApiKey: string; let secrets: any;

  beforeAll(async () => {
    fixture = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR], true);
    const doctor = fixture.users.get(MedicalWorkerRole.DOCTOR)!;
    const serviceModule = await import('../src/services/service-account.js');
    const service = await serviceModule.serviceAccountService.create({ name: `Live E2E LIS ${randomUUID()}` }, 1);
    serviceId = service.account.id; serviceApiKey = service.apiKey;
    const patient = await prisma.patient.create({ data: { firstName: 'Live', lastName: 'E2E', birthDate: new Date('1990-01-01'), medicalRecord: { create: {} } }, include: { medicalRecord: true } });
    patientId = patient.id; recordId = patient.medicalRecord!.id;
    textTestId = (await prisma.labTest.create({ data: { name: 'Live qualitative', loincCode: '24110-9', resultKind: 'TEXT' } })).id;
    quantityTestId = (await prisma.labTest.create({ data: { name: 'Live glucose', loincCode: '2345-7', resultKind: 'QUANTITY', unitCode: 'mg/dL', unitDisplay: 'mg/dL' } })).id;
    const batch = await prisma.labOrderBatch.create({ data: { medicalRecordId: recordId, requesterId: doctor.workerId, createdByAccountId: doctor.accountId, idempotencyKey: randomUUID(), requestHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), orders: { create: [
      { labTestId: textTestId, testNameSnapshot: 'Live qualitative', loincCodeSnapshot: '24110-9', resultKindSnapshot: 'TEXT' },
      { labTestId: quantityTestId, testNameSnapshot: 'Live glucose', loincCodeSnapshot: '2345-7', resultKindSnapshot: 'QUANTITY', unitCodeSnapshot: 'mg/dL', unitDisplaySnapshot: 'mg/dL' },
    ] } }, include: { orders: true } });
    [textOrderId, quantityOrderId] = batch.orders.map((item) => item.id);
    const certificateDirectory = new URL('../../certificates/local/', import.meta.url);
    server = createServer({ key: readFileSync(new URL('server.key.pem', certificateDirectory)), cert: readFileSync(new URL('server.cert.pem', certificateDirectory)), minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, app);
    await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('HTTPS test server did not bind.');
    baseUrl = `https://localhost:${address.port}`; process.env.FHIR_PUBLIC_BASE_URL = `${baseUrl}/api/fhir/r5`;
    const lisRoot = new URL('../../lis/src/main/', import.meta.url).href;
    const [{ LisDatabase }, { ConnectionService }, { FhirRequestService }, { SubmissionService }] = await Promise.all([
      import(`${lisRoot}database/index.ts`), import(`${lisRoot}auth/connection-service.ts`), import(`${lisRoot}fhir/request-service.ts`), import(`${lisRoot}fhir/submission-service.ts`),
    ]);
    directory = mkdtempSync(join(tmpdir(), 'medsoft-live-e2e-')); databasePath = join(directory, 'lis.sqlite'); database = new LisDatabase(databasePath);
    const key = randomBytes(32);
    secrets = {
      available: async () => true,
      encrypt: async (value: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
      decrypt: async (value: Uint8Array) => { const data = Buffer.from(value); const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'); },
    };
    const connection = new ConnectionService(database, secrets);
    await connection.configure({ hisUrl: baseUrl, apiKey: service.apiKey });
    const requests = new FhirRequestService(connection);
    const submissions = new SubmissionService(database, connection, requests, secrets);
    await submissions.initializeEncryption();
    (globalThis as any).__live = { connection, requests, submissions, LisDatabase, FhirRequestService, SubmissionService };
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    database?.close(); if (directory) rmSync(directory, { recursive: true, force: true });
    await prisma.labResult.deleteMany({ where: { createdByServiceAccountId: serviceId } });
    await prisma.labOrder.deleteMany({ where: { batch: { medicalRecordId: recordId } } }); await prisma.labOrderBatch.deleteMany({ where: { medicalRecordId: recordId } });
    await prisma.labTest.deleteMany({ where: { id: { in: [textTestId, quantityTestId] } } }); await prisma.medicalRecord.deleteMany({ where: { id: recordId } }); await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.refreshSession.deleteMany({ where: { serviceAccountId: serviceId } }); await prisma.auditEvent.deleteMany({ where: { serviceAccountId: serviceId } }); await prisma.serviceAccount.deleteMany({ where: { id: serviceId } });
    await fixture?.cleanup(); delete process.env.FHIR_PUBLIC_BASE_URL; delete (globalThis as any).__live; await prisma.$disconnect();
  });

  it('uses real TLS, SERVICE tokens and FHIR for TEXT and QUANTITY results', async () => {
    const { connection, requests, submissions, LisDatabase, FhirRequestService, SubmissionService } = (globalThis as any).__live;
    expect((await connection.test()).fhirVersion).toBe('5.0.0');
    const page = await requests.list({ filter: 'active', offset: 0 }); expect(page.items.map((item: any) => item.id)).toEqual(expect.arrayContaining([textOrderId, quantityOrderId]));
    expect((await requests.details(textOrderId)).patient.id).toBe(String(patientId));
    expect((await submissions.submit({ requestId: textOrderId, value: 'negative' })).state).toBe('COMPLETED');
    const config = database.getConnection(); const textRow = database.getSubmission(config.connectionId, textOrderId);
    const textObservation = JSON.parse(await secrets.decrypt(textRow.observationCipher));
    const repeated = await connection.fhirPost('/api/fhir/r5/Observation', textObservation, `identifier=${encodeURIComponent(`${textRow.identifierSystem}|${textRow.identifierValue}`)}`);
    expect(repeated.status).toBe(200);

    let loseNextObservationResponse = true;
    const lossyFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (loseNextObservationResponse && init?.method === 'POST' && String(input).endsWith('/api/fhir/r5/Observation')) { loseNextObservationResponse = false; await response.arrayBuffer(); throw new Error('simulated response loss'); }
      return response;
    };
    const lossyConnection = new (connection.constructor as any)(database, secrets, lossyFetch);
    await lossyConnection.configure({ hisUrl: baseUrl, apiKey: serviceApiKey });
    const lossyRequests = new FhirRequestService(lossyConnection); const lossySubmissions = new SubmissionService(database, lossyConnection, lossyRequests, secrets);
    expect((await lossySubmissions.submit({ requestId: quantityOrderId, value: '101,125' })).state).toBe('UNKNOWN');
    expect((await lossySubmissions.reconcile(quantityOrderId)).state).toBe('COMPLETED');
    expect(await prisma.labResult.count({ where: { labOrderId: { in: [textOrderId, quantityOrderId] } } })).toBe(2);
    expect((await requests.details(textOrderId)).status).toBe('completed');
    expect(await lossySubmissions.listHistory()).toHaveLength(2);
    const rawDatabase = readFileSync(databasePath); for (const plaintext of ['Live E2E', 'negative', '101.125']) expect(rawDatabase.includes(Buffer.from(plaintext))).toBe(false);
    database.close(); database = new LisDatabase(databasePath); const reopened = new SubmissionService(database, lossyConnection, lossyRequests, secrets);
    expect(await reopened.listHistory()).toHaveLength(2);
  });
});
