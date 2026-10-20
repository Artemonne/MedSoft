import { randomUUID } from 'node:crypto';
import { MedicalWorkerRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { bearer, createAuthorizationFixture } from './helpers/auth-fixture.js';

describe('medical record event sourcing API', () => {
  const patientIds: number[] = [];
  const recordIds: number[] = [];
  let workerId: number;
  let diagnosisId: number;
  let patientId: number;
  let recordId: number;
  let prescriptionId: string;
  let editedPrescriptionId: string;
  let authorization: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let doctorToken: string;
  let viewerToken: string;
  let adminToken: string;

  async function unlockRecord(id = recordId) {
    const response = await request(app)
      .post(`/api/medical-records/${id}/unlock`)
      .set(bearer(doctorToken));
    expect(response.status).toBe(200);
    return response;
  }

  beforeAll(async () => {
    authorization = await createAuthorizationFixture(
      [MedicalWorkerRole.DOCTOR, MedicalWorkerRole.OTHER],
      true,
    );
    const doctor = authorization.users.get(MedicalWorkerRole.DOCTOR)!;
    workerId = doctor.workerId;
    doctorToken = doctor.accessToken;
    viewerToken = authorization.users.get(MedicalWorkerRole.OTHER)!.accessToken;
    adminToken = authorization.adminAccessToken!;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const [diagnosis, patient] = await Promise.all([
      prisma.diagnosis.create({
        data: { code: suffix.slice(0, 6).toUpperCase(), name: `Dx ${suffix}` },
      }),
      prisma.patient.create({
        data: {
          firstName: 'Record',
          lastName: 'Patient',
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          sex: 'UNKNOWN',
        },
      }),
    ]);

    diagnosisId = diagnosis.id;
    patientId = patient.id;
    patientIds.push(patient.id);
  });

  afterAll(async () => {
    await prisma.medicalRecordEvent.deleteMany({ where: { medicalRecordId: { in: recordIds } } });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.diagnosis.deleteMany({ where: { id: diagnosisId } });
    await authorization.cleanup();
    await prisma.$disconnect();
  });

  it('creates and retrieves one medical record for a patient', async () => {
    const createResponse = await request(app)
      .post(`/api/patients/${patientId}/medical-record`)
      .set(bearer(doctorToken))
      .send({});

    expect(createResponse.status).toBe(201);
    recordId = createResponse.body.id;
    recordIds.push(recordId);

    const duplicateResponse = await request(app)
      .post(`/api/patients/${patientId}/medical-record`)
      .set(bearer(doctorToken))
      .send({});
    expect(duplicateResponse.status).toBe(409);

    const byPatient = await request(app)
      .get(`/api/patients/${patientId}/medical-record`)
      .set(bearer(viewerToken));
    expect(byPatient.status).toBe(200);
    expect(byPatient.body).toMatchObject({
      id: recordId,
      patientId,
      diagnoses: [],
      prescriptions: [],
    });

    const byId = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(recordId);
    expect(byId.body.isEditingLocked).toBe(true);

    const unlock = await request(app)
      .post(`/api/medical-records/${recordId}/unlock`)
      .set(bearer(doctorToken));
    expect(unlock.status).toBe(200);
    expect(unlock.body.isEditingLocked).toBe(false);
  });

  it('protects a patient that has a medical record from deletion', async () => {
    const response = await request(app)
      .delete(`/api/patients/${patientId}`)
      .set(bearer(doctorToken));

    expect(response.status).toBe(409);
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });

  it('adds, reconstructs, and removes a diagnosis', async () => {
    const spoofedAuthor = await request(app)
      .post(`/api/medical-records/${recordId}/diagnoses`)
      .set(bearer(doctorToken))
      .send({
        diagnosisId,
        workerId: authorization.users.get(MedicalWorkerRole.OTHER)!.workerId,
      });
    expect(spoofedAuthor.status).toBe(400);

    const addResponse = await request(app)
      .post(`/api/medical-records/${recordId}/diagnoses`)
      .set(bearer(doctorToken))
      .send({ diagnosisId });
    expect(addResponse.status).toBe(201);

    const stateWithDiagnosis = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(stateWithDiagnosis.body.diagnoses).toEqual([
      expect.objectContaining({ diagnosisId }),
    ]);
    expect(stateWithDiagnosis.body.isEditingLocked).toBe(true);

    const duplicateResponse = await request(app)
      .post(`/api/medical-records/${recordId}/diagnoses`)
      .set(bearer(doctorToken))
      .send({ diagnosisId });
    expect(duplicateResponse.status).toBe(409);

    await unlockRecord();
    const removeResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/diagnoses/${diagnosisId}`)
      .set(bearer(doctorToken))
      .send({});
    expect(removeResponse.status).toBe(200);

    const stateWithoutDiagnosis = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(stateWithoutDiagnosis.body.diagnoses).toEqual([]);

    const inactiveResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/diagnoses/${diagnosisId}`)
      .set(bearer(doctorToken))
      .send({});
    expect(inactiveResponse.status).toBe(409);
  });

  it('validates prescription text length', async () => {
    const shortResponse = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .set(bearer(doctorToken))
      .send({ text: 'No' });
    expect(shortResponse.status).toBe(400);

    const longResponse = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .set(bearer(doctorToken))
      .send({ text: 'x'.repeat(129) });
    expect(longResponse.status).toBe(400);
  });

  it('adds a prescription to reconstructed state', async () => {
    await unlockRecord();
    const response = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .set(bearer(doctorToken))
      .send({ text: 'Take one tablet daily' });

    expect(response.status).toBe(201);
    expect(response.body.prescriptionId).toEqual(expect.any(String));
    prescriptionId = response.body.prescriptionId;

    const state = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(state.body.prescriptions).toEqual([
      { prescriptionId, text: 'Take one tablet daily' },
    ]);
    expect(state.body.isEditingLocked).toBe(true);
  });

  it('edits a prescription with remove and add events in one transaction', async () => {
    const before = await request(app)
      .get(`/api/medical-records/${recordId}/events`)
      .set(bearer(viewerToken));

    await unlockRecord();
    const response = await request(app)
      .put(`/api/medical-records/${recordId}/prescriptions/${prescriptionId}`)
      .set(bearer(doctorToken))
      .send({ text: 'Take two tablets daily' });

    expect(response.status).toBe(200);
    editedPrescriptionId = response.body.prescriptionId;
    expect(editedPrescriptionId).not.toBe(prescriptionId);

    const after = await request(app)
      .get(`/api/medical-records/${recordId}/events`)
      .set(bearer(viewerToken));
    expect(after.body).toHaveLength(before.body.length + 2);
    expect(after.body.slice(-2).map((event: { type: string }) => event.type)).toEqual([
      'PRESCRIPTION_REMOVED',
      'PRESCRIPTION_ADDED',
    ]);

    const state = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(state.body.prescriptions).toEqual([
      { prescriptionId: editedPrescriptionId, text: 'Take two tablets daily' },
    ]);
  });

  it('removes an active prescription and rejects another removal', async () => {
    await unlockRecord();
    const removeResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/prescriptions/${editedPrescriptionId}`)
      .set(bearer(doctorToken))
      .send({});
    expect(removeResponse.status).toBe(200);

    const state = await request(app)
      .get(`/api/medical-records/${recordId}`)
      .set(bearer(viewerToken));
    expect(state.body.prescriptions).toEqual([]);

    const inactiveResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/prescriptions/${editedPrescriptionId}`)
      .set(bearer(doctorToken))
      .send({});
    expect(inactiveResponse.status).toBe(409);
  });

  it('serializes concurrent event version allocation', async () => {
    await unlockRecord();
    const before = await prisma.medicalRecordEvent.count({ where: { medicalRecordId: recordId } });
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/medical-records/${recordId}/prescriptions`)
        .set(bearer(doctorToken))
        .send({ text: 'Concurrent prescription one' }),
      request(app)
        .post(`/api/medical-records/${recordId}/prescriptions`)
        .set(bearer(doctorToken))
        .send({ text: 'Concurrent prescription two' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.medicalRecordEvent.count({ where: { medicalRecordId: recordId } })).toBe(before + 1);
    expect((await prisma.medicalRecord.findUniqueOrThrow({ where: { id: recordId } })).isEditingLocked).toBe(true);
  });

  it('returns ordered event versions and worker details', async () => {
    const response = await request(app)
      .get(`/api/medical-records/${recordId}/events`)
      .set(bearer(viewerToken));

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.map((event: { version: number }) => event.version)).toEqual(
      response.body.map((_: unknown, index: number) => index + 1),
    );
    expect(response.body[0].worker).toMatchObject({ id: workerId, isDeleted: false });
  });

  it('reconstructs historical state by timestamp and version order', async () => {
    const historicalPatient = await prisma.patient.create({
      data: {
        firstName: 'History',
        lastName: 'Patient',
        birthDate: new Date('1985-05-05T00:00:00.000Z'),
        sex: 'UNKNOWN',
      },
    });
    patientIds.push(historicalPatient.id);

    const recordResponse = await request(app)
      .post(`/api/patients/${historicalPatient.id}/medical-record`)
      .set(bearer(doctorToken))
      .send({});
    const historicalRecordId = recordResponse.body.id;
    recordIds.push(historicalRecordId);

    await unlockRecord(historicalRecordId);

    await request(app)
      .post(`/api/medical-records/${historicalRecordId}/diagnoses`)
      .set(bearer(doctorToken))
      .send({ diagnosisId });
    await unlockRecord(historicalRecordId);
    const prescriptionResponse = await request(app)
      .post(`/api/medical-records/${historicalRecordId}/prescriptions`)
      .set(bearer(doctorToken))
      .send({ text: 'Historical prescription' });
    await unlockRecord(historicalRecordId);
    await request(app)
      .delete(`/api/medical-records/${historicalRecordId}/diagnoses/${diagnosisId}`)
      .set(bearer(doctorToken))
      .send({});

    const times = [
      new Date('2026-01-01T10:00:00.000Z'),
      new Date('2026-01-01T11:00:00.000Z'),
      new Date('2026-01-01T12:00:00.000Z'),
    ];
    const events = await prisma.medicalRecordEvent.findMany({
      where: { medicalRecordId: historicalRecordId },
      orderBy: { version: 'asc' },
    });
    await Promise.all(
      events.map((event, index) =>
        prisma.medicalRecordEvent.update({
          where: { id: event.id },
          data: { createdAt: times[index] },
        }),
      ),
    );

    const firstState = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=${encodeURIComponent(times[0].toISOString())}`,
    ).set(bearer(viewerToken));
    expect(firstState.body.diagnoses).toHaveLength(1);
    expect(firstState.body.prescriptions).toEqual([]);

    const secondState = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=${encodeURIComponent(times[1].toISOString())}`,
    ).set(bearer(viewerToken));
    expect(secondState.body.diagnoses).toHaveLength(1);
    expect(secondState.body.prescriptions).toEqual([
      expect.objectContaining({ prescriptionId: prescriptionResponse.body.prescriptionId }),
    ]);

    const finalState = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=${encodeURIComponent(times[2].toISOString())}`,
    ).set(bearer(viewerToken));
    expect(finalState.body.diagnoses).toEqual([]);
    expect(finalState.body.prescriptions).toHaveLength(1);

    const invalidTimestamp = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=not-a-date`,
    ).set(bearer(viewerToken));
    expect(invalidTimestamp.status).toBe(400);
  });

  it('keeps deleted workers readable in history but blocks new modifications', async () => {
    const deleteWorker = await request(app)
      .delete(`/api/medical-workers/${workerId}`)
      .set(bearer(adminToken));
    expect(deleteWorker.status).toBe(204);

    const events = await request(app)
      .get(`/api/medical-records/${recordId}/events`)
      .set(bearer(viewerToken));
    expect(events.status).toBe(200);
    expect(events.body[0].worker).toMatchObject({ id: workerId, isDeleted: true });

    const modification = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .set(bearer(doctorToken))
      .send({ text: 'Must be rejected' });
    expect(modification.status).toBe(401);
  });
});
