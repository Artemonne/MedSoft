import { randomUUID } from 'node:crypto';
import { MedicalWorkerRole } from '@prisma/client';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { TOTP_ISSUER, TOTP_LABEL } from '../src/lib/totp.js';
import { auditService } from '../src/services/audit.js';
import { bearer, createAuthorizationFixture } from './helpers/auth-fixture.js';

const administratorPassword = 'Audit administrator password 370553';
const userPassword = 'Audit user password 370553';
const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('centralized security audit', () => {
  let authorization: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let adminToken: string;
  let doctorToken: string;
  const patientIds: number[] = [];
  const recordIds: number[] = [];
  const workerIds: number[] = [];
  const managedAccountIds: string[] = [];
  const secrets: string[] = [administratorPassword, userPassword, totpSecret];

  function currentTotp(): string {
    return new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: TOTP_LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(totpSecret),
    }).generate();
  }

  beforeAll(async () => {
    await prisma.auditEvent.deleteMany();
    authorization = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR], true);
    adminToken = authorization.adminAccessToken!;
    doctorToken = authorization.users.get(MedicalWorkerRole.DOCTOR)!.accessToken;

    await prisma.account.update({
      where: { id: authorization.users.get(MedicalWorkerRole.DOCTOR)!.accountId },
      data: { passwordHash: await hashPassword(userPassword) },
    });
    await prisma.systemAdministrator.update({
      where: { id: 1 },
      data: { passwordHash: await hashPassword(administratorPassword), totpSecret },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.refreshSession.deleteMany({
      where: { accountId: { in: managedAccountIds } },
    });
    await prisma.medicalRecordEvent.deleteMany({
      where: { medicalRecordId: { in: recordIds } },
    });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.account.deleteMany({ where: { id: { in: managedAccountIds } } });
    await prisma.medicalWorker.deleteMany({ where: { id: { in: workerIds } } });
    await authorization.cleanup();
    await prisma.$disconnect();
  });

  it('records successful and failed logins with stable actors and no credentials', async () => {
    const adminLogin = await request(app).post('/api/admin/auth/login').send({
      password: administratorPassword,
      totpCode: currentTotp(),
    });
    expect(adminLogin.status).toBe(200);
    secrets.push(adminLogin.body.accessToken);

    const failedAdmin = await request(app).post('/api/admin/auth/login').send({
      password: 'Wrong administrator password 370553',
      totpCode: currentTotp(),
    });
    expect(failedAdmin.status).toBe(401);
    const adminRequestId = failedAdmin.headers['x-request-id'];

    const doctor = authorization.users.get(MedicalWorkerRole.DOCTOR)!;
    const userLogin = await request(app).post('/api/auth/login').send({
      username: doctor.username,
      password: userPassword,
    });
    expect(userLogin.status).toBe(200);
    secrets.push(userLogin.body.accessToken);

    const failed = await request(app).post('/api/auth/login').send({
      username: `missing${randomUUID().slice(0, 6)}`,
      password: 'Definitely wrong password 370553',
    });
    expect(failed.status).toBe(401);
    const requestId = failed.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);

    const events = await prisma.auditEvent.findMany({
      where: {
        eventType: {
          in: ['ADMIN_LOGIN_SUCCEEDED', 'USER_LOGIN_SUCCEEDED', 'LOGIN_FAILED'],
        },
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'ADMIN_LOGIN_SUCCEEDED',
          actorType: 'ADMIN',
          actorIdentifier: 'admin:1',
          systemAdministratorId: 1,
        }),
        expect.objectContaining({
          eventType: 'USER_LOGIN_SUCCEEDED',
          actorType: 'USER',
          actorIdentifier: `account:${doctor.accountId}`,
          accountId: doctor.accountId,
        }),
        expect.objectContaining({
          eventType: 'LOGIN_FAILED',
          actorType: 'ANONYMOUS',
          actorIdentifier: `request:${requestId}`,
        }),
        expect.objectContaining({
          eventType: 'LOGIN_FAILED',
          actorType: 'ANONYMOUS',
          actorIdentifier: `request:${adminRequestId}`,
          metadata: expect.objectContaining({ authenticationKind: 'administrator' }),
        }),
      ]),
    );
  });

  it('records worker, patient, record, and account changes in their business transactions', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const createdWorker = await request(app)
      .post('/api/medical-workers')
      .set(bearer(adminToken))
      .send({ firstName: 'Audit', lastName: 'Worker', position: 'Physician', role: 'doctor' });
    expect(createdWorker.status).toBe(201);
    workerIds.push(createdWorker.body.id);

    const updatedWorker = await request(app)
      .put(`/api/medical-workers/${createdWorker.body.id}`)
      .set(bearer(adminToken))
      .send({ firstName: 'Audit', lastName: 'Updated', position: 'Physician', role: 'nurse' });
    expect(updatedWorker.status).toBe(200);

    const disposableWorker = await request(app)
      .post('/api/medical-workers')
      .set(bearer(adminToken))
      .send({ firstName: 'Audit', lastName: 'Deleted', position: 'Physician', role: 'other' });
    expect(disposableWorker.status).toBe(201);
    workerIds.push(disposableWorker.body.id);
    expect(
      (await request(app)
        .delete(`/api/medical-workers/${disposableWorker.body.id}`)
        .set(bearer(adminToken))).status,
    ).toBe(204);

    const patientBody = {
      firstName: 'Audit',
      lastName: 'Patient',
      birthDate: '1990-01-01',
      sex: 'UNKNOWN',
    };
    const patient = await request(app)
      .post('/api/patients')
      .set(bearer(doctorToken))
      .send(patientBody);
    expect(patient.status).toBe(201);
    patientIds.push(patient.body.id);
    expect(
      (await request(app)
        .put(`/api/patients/${patient.body.id}`)
        .set(bearer(doctorToken))
        .send({ ...patientBody, lastName: 'Changed' })).status,
    ).toBe(200);
    expect(
      (await request(app)
        .delete(`/api/patients/${patient.body.id}`)
        .set(bearer(doctorToken))).status,
    ).toBe(204);
    patientIds.splice(patientIds.indexOf(patient.body.id), 1);

    const recordPatient = await request(app)
      .post('/api/patients')
      .set(bearer(doctorToken))
      .send({ ...patientBody, lastName: 'Record' });
    expect(recordPatient.status).toBe(201);
    patientIds.push(recordPatient.body.id);
    const record = await request(app)
      .post(`/api/patients/${recordPatient.body.id}/medical-record`)
      .set(bearer(doctorToken))
      .send({});
    expect(record.status).toBe(201);
    recordIds.push(record.body.id);
    expect(
      (await request(app)
        .post(`/api/medical-records/${record.body.id}/unlock`)
        .set(bearer(doctorToken))
        .send({})).status,
    ).toBe(200);
    expect(
      (await request(app)
        .post(`/api/medical-records/${record.body.id}/prescriptions`)
        .set(bearer(doctorToken))
        .send({ text: 'Audit test prescription' })).status,
    ).toBe(201);

    const accountCreation = await request(app)
      .post('/api/admin/accounts')
      .set(bearer(adminToken))
      .send({ username: `audit${suffix}`, medicalWorkerId: createdWorker.body.id });
    expect(accountCreation.status).toBe(201);
    const accountId = accountCreation.body.account.id as string;
    managedAccountIds.push(accountId);
    let currentPassword = accountCreation.body.generatedPassword as string;
    secrets.push(currentPassword);

    expect(
      (await request(app).post('/api/auth/login').send({
        username: `audit${suffix}`,
        password: currentPassword,
      })).status,
    ).toBe(200);
    const reset = await request(app)
      .post(`/api/admin/accounts/${accountId}/password`)
      .set(bearer(adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.revokedRefreshTokens).toBe(1);
    currentPassword = reset.body.generatedPassword;
    secrets.push(currentPassword);

    expect(
      (await request(app).post('/api/auth/login').send({
        username: `audit${suffix}`,
        password: currentPassword,
      })).status,
    ).toBe(200);
    const roleChange = await request(app)
      .patch(`/api/admin/accounts/${accountId}/role`)
      .set(bearer(adminToken))
      .send({ role: 'doctor' });
    expect(roleChange.body.revokedRefreshTokens).toBe(1);

    expect(
      (await request(app).post('/api/auth/login').send({
        username: `audit${suffix}`,
        password: currentPassword,
      })).status,
    ).toBe(200);
    const deactivate = await request(app)
      .patch(`/api/admin/accounts/${accountId}/status`)
      .set(bearer(adminToken))
      .send({ isActive: false });
    expect(deactivate.body.revokedRefreshTokens).toBe(1);
    expect(
      (await request(app)
        .patch(`/api/admin/accounts/${accountId}/status`)
        .set(bearer(adminToken))
        .send({ isActive: true })).status,
    ).toBe(200);

    expect(
      (await request(app).post('/api/auth/login').send({
        username: `audit${suffix}`,
        password: currentPassword,
      })).status,
    ).toBe(200);
    expect(
      (await request(app)
        .delete(`/api/medical-workers/${createdWorker.body.id}`)
        .set(bearer(adminToken))).status,
    ).toBe(204);

    const accountEvents = await prisma.auditEvent.findMany({
      where: { eventType: { startsWith: 'ACCOUNT_' } },
    });
    for (const eventType of [
      'ACCOUNT_CREATED',
      'ACCOUNT_PASSWORD_CHANGED',
      'ACCOUNT_ACTIVATION_CHANGED',
      'ACCOUNT_ROLE_CHANGED',
      'ACCOUNT_DEACTIVATED_BY_WORKER_DELETION',
    ]) {
      expect(accountEvents.some((event) => event.eventType === eventType)).toBe(true);
    }
    const revokedCounts = accountEvents
      .filter((event) => event.eventType !== 'ACCOUNT_CREATED')
      .map((event) => (event.metadata as { revokedRefreshTokens: number }).revokedRefreshTokens);
    expect(revokedCounts).toEqual(expect.arrayContaining([0, 1]));
    expect(
      accountEvents.find((event) => event.eventType === 'ACCOUNT_DEACTIVATED_BY_WORKER_DELETION'),
    ).toEqual(expect.objectContaining({
      actorType: 'SYSTEM',
      actorIdentifier: 'system:medical-worker-deletion',
      metadata: expect.objectContaining({ revokedRefreshTokens: 1 }),
    }));

    const expectedTypes = [
      'MEDICAL_WORKER_CREATED',
      'MEDICAL_WORKER_UPDATED',
      'MEDICAL_WORKER_DELETED',
      'PATIENT_CREATED',
      'PATIENT_UPDATED',
      'PATIENT_DELETED',
      'MEDICAL_RECORD_CREATED',
      'MEDICAL_RECORD_UNLOCKED',
      'MEDICAL_RECORD_PRESCRIPTION_ADDED',
    ];
    const recordedTypes = new Set(
      (await prisma.auditEvent.findMany({ select: { eventType: true } })).map(
        (event) => event.eventType,
      ),
    );
    for (const eventType of expectedTypes) expect(recordedTypes.has(eventType)).toBe(true);
  });

  it('exposes immutable admin-only history and never returns recorded secrets', async () => {
    const denied = await request(app)
      .get('/api/admin/audit')
      .set(bearer(doctorToken));
    expect(denied.status).toBe(401);

    const history = await request(app)
      .get('/api/admin/audit?limit=100')
      .set(bearer(adminToken));
    expect(history.status).toBe(200);
    expect(history.body.events.length).toBeGreaterThan(0);
    for (const event of history.body.events) {
      expect(event.id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
      expect(event.actorIdentifier.length).toBeGreaterThan(0);
      expect(event.message.length).toBeGreaterThan(0);
    }
    for (let index = 1; index < history.body.events.length; index += 1) {
      const previous = history.body.events[index - 1];
      const current = history.body.events[index];
      expect(
        previous.occurredAt > current.occurredAt ||
          (previous.occurredAt === current.occurredAt && previous.id > current.id),
      ).toBe(true);
    }
    const serialized = JSON.stringify(history.body);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/passwordHash|totpSecret/i);
    expect(serialized).not.toContain('"refreshToken":');

    const firstPage = await request(app)
      .get('/api/admin/audit?limit=2')
      .set(bearer(adminToken));
    const secondPage = await request(app)
      .get(`/api/admin/audit?limit=2&before=${encodeURIComponent(firstPage.body.nextCursor)}`)
      .set(bearer(adminToken));
    expect(firstPage.body.hasMore).toBe(true);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.events).toHaveLength(2);
    const firstPageIds = new Set(
      firstPage.body.events.map((event: { id: string }) => event.id),
    );
    expect(
      secondPage.body.events.some((event: { id: string }) => firstPageIds.has(event.id)),
    ).toBe(false);

    const count = await prisma.auditEvent.count();
    for (const method of ['post', 'put', 'delete'] as const) {
      const response = await request(app)[method]('/api/admin/audit/not-an-event')
        .set(bearer(adminToken))
        .send({ message: 'tamper' });
      expect(response.status).toBe(404);
    }
    expect(await prisma.auditEvent.count()).toBe(count);

    await expect(
      auditService.recordStandalone({
        eventType: 'LOGIN_FAILED',
        actor: { type: 'system', identifier: 'metadata-validation-test' },
        message: 'Metadata validation test.',
        metadata: { password: 'must-not-be-written' },
      }),
    ).rejects.toThrow('Sensitive audit metadata key is forbidden');
    expect(await prisma.auditEvent.count()).toBe(count);
  });

  it('delivers cursor-based changes within two seconds without reconnection duplicates', async () => {
    const checkpoint = await request(app)
      .get('/api/admin/audit/checkpoint')
      .set(bearer(adminToken));
    expect(checkpoint.status).toBe(200);

    const startedAt = Date.now();
    const patient = await request(app)
      .post('/api/patients')
      .set(bearer(doctorToken))
      .send({
        firstName: 'Polling',
        lastName: 'Audit',
        birthDate: '1990-01-01',
        sex: 'UNKNOWN',
      });
    patientIds.push(patient.body.id);
    const changes = await request(app)
      .get(`/api/admin/audit/changes?after=${encodeURIComponent(checkpoint.body.cursor)}`)
      .set(bearer(adminToken));
    expect(changes.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(2_000);
    expect(changes.headers['cache-control']).toBe('no-store');
    expect(changes.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PATIENT_CREATED',
          metadata: expect.objectContaining({ patientId: patient.body.id }),
        }),
      ]),
    );

    const reconnect = await request(app)
      .get(`/api/admin/audit/changes?after=${encodeURIComponent(changes.body.nextCursor)}`)
      .set(bearer(adminToken));
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.events).toEqual([]);

    const invalid = await request(app)
      .get('/api/admin/audit/changes?after=invalid')
      .set(bearer(adminToken));
    expect(invalid.status).toBe(400);
    expect(invalid.body).not.toHaveProperty('events');
  });

  it('rolls a critical database change back when its audit write fails', async () => {
    const marker = randomUUID();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const record = vi.spyOn(auditService, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    const response = await request(app)
      .post('/api/patients')
      .set(bearer(doctorToken))
      .send({
        firstName: 'Rollback',
        lastName: marker,
        birthDate: '1990-01-01',
        sex: 'UNKNOWN',
      });
    record.mockRestore();
    errorLog.mockRestore();

    expect(response.status).toBe(500);
    expect(await prisma.patient.count({ where: { lastName: marker } })).toBe(0);
  });
});
