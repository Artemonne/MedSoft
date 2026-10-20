import { randomUUID } from 'node:crypto';
import { MedicalWorkerRole } from '@prisma/client';
import { importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { bearer, createAuthorizationFixture } from './helpers/auth-fixture.js';

describe('server-side role authorization', () => {
  let authorization: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  const patientIds: number[] = [];
  const recordIds: number[] = [];
  let diagnosisId: number;
  let doctorRecordId: number;

  function token(role: MedicalWorkerRole): string {
    return authorization.users.get(role)!.accessToken;
  }

  async function createPatient(role: MedicalWorkerRole, marker: string) {
    return request(app)
      .post('/api/patients')
      .set(bearer(token(role)))
      .send({
        firstName: marker,
        lastName: 'Authorization',
        birthDate: '1990-01-01',
        sex: 'UNKNOWN',
      });
  }

  beforeAll(async () => {
    authorization = await createAuthorizationFixture(
      [
        MedicalWorkerRole.DOCTOR,
        MedicalWorkerRole.NURSE,
        MedicalWorkerRole.LABORATORY_TECHNICIAN,
        MedicalWorkerRole.OTHER,
      ],
      true,
    );
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const patient = await prisma.patient.create({
      data: {
        firstName: 'View',
        lastName: 'Record',
        birthDate: new Date('1980-01-01T00:00:00.000Z'),
        sex: 'UNKNOWN',
      },
    });
    const record = await prisma.medicalRecord.create({ data: { patientId: patient.id } });
    const diagnosis = await prisma.diagnosis.create({
      data: { code: suffix.slice(0, 6).toUpperCase(), name: `Az ${suffix}` },
    });
    patientIds.push(patient.id);
    recordIds.push(record.id);
    doctorRecordId = record.id;
    diagnosisId = diagnosis.id;
  });

  afterAll(async () => {
    await prisma.medicalRecordEvent.deleteMany({ where: { medicalRecordId: { in: recordIds } } });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.diagnosis.deleteMany({ where: { id: diagnosisId } });
    await authorization.cleanup();
    await prisma.$disconnect();
  });

  it('returns 401 for missing, invalid, tampered, and expired access tokens', async () => {
    const doctor = authorization.users.get(MedicalWorkerRole.DOCTOR)!;
    const segments = doctor.accessToken.split('.');
    segments[1] = `${segments[1][0] === 'A' ? 'B' : 'A'}${segments[1].slice(1)}`;
    const signingKey = await importPKCS8(
      authorization.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'EdDSA',
    );
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({
      tokenType: 'access',
      subjectType: 'user',
      sessionId: doctor.sessionId,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer('medsoft-api')
      .setAudience('medsoft-client')
      .setSubject(doctor.accountId)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(signingKey);

    for (const accessToken of [undefined, 'not-a-jwt', segments.join('.'), expired]) {
      const call = request(app).get(`/api/medical-records/${doctorRecordId}`);
      if (accessToken) call.set(bearer(accessToken));
      const response = await call;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('does not leave any business router public', async () => {
    for (const path of [
      '/api/patients',
      '/api/diagnoses',
      `/api/medical-records/${doctorRecordId}`,
      '/api/medical-workers',
      '/api/admin/accounts',
      '/api/admin/diagnoses',
    ]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
    }
  });

  it('allows all active medical-worker roles to view medical records', async () => {
    for (const role of [
      MedicalWorkerRole.DOCTOR,
      MedicalWorkerRole.NURSE,
      MedicalWorkerRole.LABORATORY_TECHNICIAN,
      MedicalWorkerRole.OTHER,
    ]) {
      const response = await request(app)
        .get(`/api/medical-records/${doctorRecordId}`)
        .set(bearer(token(role)));
      expect(response.status).toBe(200);
    }
  });

  it('allows doctor and nurse to create patients and records', async () => {
    for (const [role, marker] of [
      [MedicalWorkerRole.DOCTOR, 'Doctor'],
      [MedicalWorkerRole.NURSE, 'Nurse'],
    ] as const) {
      const patientResponse = await createPatient(role, marker);
      expect(patientResponse.status).toBe(201);
      patientIds.push(patientResponse.body.id);

      const recordResponse = await request(app)
        .post(`/api/patients/${patientResponse.body.id}/medical-record`)
        .set(bearer(token(role)))
        .send({});
      expect(recordResponse.status).toBe(201);
      expect(recordResponse.body.isEditingLocked).toBe(true);
      recordIds.push(recordResponse.body.id);
    }
  });

  it('denies patient and record creation to laboratory-technician and other', async () => {
    for (const role of [MedicalWorkerRole.LABORATORY_TECHNICIAN, MedicalWorkerRole.OTHER]) {
      const patientResponse = await createPatient(role, role);
      const recordResponse = await request(app)
        .post(`/api/patients/${patientIds[0]}/medical-record`)
        .set(bearer(token(role)))
        .send({});
      expect(patientResponse.status).toBe(403);
      expect(recordResponse.status).toBe(403);
    }
  });

  it('keeps records locked until a doctor unlocks them', async () => {
    const lockedWrite = await request(app)
      .post(`/api/medical-records/${doctorRecordId}/diagnoses`)
      .set(bearer(token(MedicalWorkerRole.DOCTOR)))
      .send({ diagnosisId });
    expect(lockedWrite.status).toBe(409);

    for (const role of [
      MedicalWorkerRole.NURSE,
      MedicalWorkerRole.LABORATORY_TECHNICIAN,
      MedicalWorkerRole.OTHER,
    ]) {
      const response = await request(app)
        .post(`/api/medical-records/${doctorRecordId}/unlock`)
        .set(bearer(token(role)));
      expect(response.status).toBe(403);
    }

    const unlock = await request(app)
      .post(`/api/medical-records/${doctorRecordId}/unlock`)
      .set(bearer(token(MedicalWorkerRole.DOCTOR)));
    expect(unlock.status).toBe(200);
    expect(unlock.body.isEditingLocked).toBe(false);
  });

  it('denies record mutation to read-only roles and stores the authenticated nurse as author', async () => {
    for (const role of [MedicalWorkerRole.LABORATORY_TECHNICIAN, MedicalWorkerRole.OTHER]) {
      const response = await request(app)
        .post(`/api/medical-records/${doctorRecordId}/diagnoses`)
        .set(bearer(token(role)))
        .send({ diagnosisId });
      expect(response.status).toBe(403);
    }

    const nurse = authorization.users.get(MedicalWorkerRole.NURSE)!;
    const response = await request(app)
      .post(`/api/medical-records/${doctorRecordId}/diagnoses`)
      .set(bearer(nurse.accessToken))
      .send({ diagnosisId });
    expect(response.status).toBe(201);

    const event = await prisma.medicalRecordEvent.findFirstOrThrow({
      where: { medicalRecordId: doctorRecordId },
      orderBy: { version: 'desc' },
    });
    expect(event.workerId).toBe(nurse.workerId);
  });

  it('rejects workerId spoofing instead of acting for another worker', async () => {
    const doctor = authorization.users.get(MedicalWorkerRole.DOCTOR)!;
    const other = authorization.users.get(MedicalWorkerRole.OTHER)!;
    const before = await prisma.medicalRecordEvent.count({
      where: { medicalRecordId: doctorRecordId },
    });
    const response = await request(app)
      .post(`/api/medical-records/${doctorRecordId}/prescriptions`)
      .set(bearer(doctor.accessToken))
      .send({ workerId: other.workerId, text: 'Forged author prescription' });

    expect(response.status).toBe(400);
    expect(
      await prisma.medicalRecordEvent.count({ where: { medicalRecordId: doctorRecordId } }),
    ).toBe(before);
  });

  it('uses current database role and active state instead of stale token privileges', async () => {
    const doctor = authorization.users.get(MedicalWorkerRole.DOCTOR)!;
    await prisma.medicalWorker.update({
      where: { id: doctor.workerId },
      data: { role: MedicalWorkerRole.OTHER },
    });

    const oldDoctorPrivilege = await createPatient(MedicalWorkerRole.DOCTOR, 'StaleRole');
    expect(oldDoctorPrivilege.status).toBe(403);

    await prisma.account.update({ where: { id: doctor.accountId }, data: { isActive: false } });
    const inactive = await request(app)
      .get(`/api/medical-records/${doctorRecordId}`)
      .set(bearer(doctor.accessToken));
    expect(inactive.status).toBe(401);
  });

  it('does not accept a medical-worker access token on administrator routes', async () => {
    for (const path of ['/api/medical-workers', '/api/admin/diagnoses']) {
      const response = await request(app)
        .get(path)
        .set(bearer(token(MedicalWorkerRole.NURSE)));
      expect(response.status).toBe(401);
    }

    for (const path of ['/api/medical-workers', '/api/admin/diagnoses']) {
      const administrator = await request(app)
        .get(path)
        .set(bearer(authorization.adminAccessToken!));
      expect(administrator.status).toBe(200);
    }
  });
});
