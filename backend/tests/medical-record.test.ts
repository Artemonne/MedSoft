import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('medical record event sourcing API', () => {
  const patientIds: number[] = [];
  const recordIds: number[] = [];
  let workerId: number;
  let diagnosisId: number;
  let patientId: number;
  let recordId: number;
  let prescriptionId: string;
  let editedPrescriptionId: string;

  beforeAll(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const [worker, diagnosis, patient] = await Promise.all([
      prisma.medicalWorker.create({
        data: { firstName: 'Event', lastName: 'Doctor', position: 'Physician' },
      }),
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

    workerId = worker.id;
    diagnosisId = diagnosis.id;
    patientId = patient.id;
    patientIds.push(patient.id);
  });

  afterAll(async () => {
    await prisma.medicalRecordEvent.deleteMany({ where: { medicalRecordId: { in: recordIds } } });
    await prisma.medicalRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.diagnosis.deleteMany({ where: { id: diagnosisId } });
    await prisma.medicalWorker.deleteMany({ where: { id: workerId } });
    await prisma.$disconnect();
  });

  it('creates and retrieves one medical record for a patient', async () => {
    const createResponse = await request(app)
      .post(`/api/patients/${patientId}/medical-record`)
      .send({});

    expect(createResponse.status).toBe(201);
    recordId = createResponse.body.id;
    recordIds.push(recordId);

    const duplicateResponse = await request(app)
      .post(`/api/patients/${patientId}/medical-record`)
      .send({});
    expect(duplicateResponse.status).toBe(409);

    const byPatient = await request(app).get(`/api/patients/${patientId}/medical-record`);
    expect(byPatient.status).toBe(200);
    expect(byPatient.body).toMatchObject({
      id: recordId,
      patientId,
      diagnoses: [],
      prescriptions: [],
    });

    const byId = await request(app).get(`/api/medical-records/${recordId}`);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(recordId);
  });

  it('protects a patient that has a medical record from deletion', async () => {
    const response = await request(app).delete(`/api/patients/${patientId}`);

    expect(response.status).toBe(409);
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });

  it('adds, reconstructs, and removes a diagnosis', async () => {
    const addResponse = await request(app)
      .post(`/api/medical-records/${recordId}/diagnoses`)
      .send({ workerId, diagnosisId });
    expect(addResponse.status).toBe(201);

    const stateWithDiagnosis = await request(app).get(`/api/medical-records/${recordId}`);
    expect(stateWithDiagnosis.body.diagnoses).toEqual([
      expect.objectContaining({ diagnosisId }),
    ]);

    const duplicateResponse = await request(app)
      .post(`/api/medical-records/${recordId}/diagnoses`)
      .send({ workerId, diagnosisId });
    expect(duplicateResponse.status).toBe(409);

    const removeResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/diagnoses/${diagnosisId}`)
      .send({ workerId });
    expect(removeResponse.status).toBe(200);

    const stateWithoutDiagnosis = await request(app).get(`/api/medical-records/${recordId}`);
    expect(stateWithoutDiagnosis.body.diagnoses).toEqual([]);

    const inactiveResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/diagnoses/${diagnosisId}`)
      .send({ workerId });
    expect(inactiveResponse.status).toBe(409);
  });

  it('validates prescription text length', async () => {
    const shortResponse = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .send({ workerId, text: 'No' });
    expect(shortResponse.status).toBe(400);

    const longResponse = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .send({ workerId, text: 'x'.repeat(129) });
    expect(longResponse.status).toBe(400);
  });

  it('adds a prescription to reconstructed state', async () => {
    const response = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .send({ workerId, text: 'Take one tablet daily' });

    expect(response.status).toBe(201);
    expect(response.body.prescriptionId).toEqual(expect.any(String));
    prescriptionId = response.body.prescriptionId;

    const state = await request(app).get(`/api/medical-records/${recordId}`);
    expect(state.body.prescriptions).toEqual([
      { prescriptionId, text: 'Take one tablet daily' },
    ]);
  });

  it('edits a prescription with remove and add events in one transaction', async () => {
    const before = await request(app).get(`/api/medical-records/${recordId}/events`);

    const response = await request(app)
      .put(`/api/medical-records/${recordId}/prescriptions/${prescriptionId}`)
      .send({ workerId, text: 'Take two tablets daily' });

    expect(response.status).toBe(200);
    editedPrescriptionId = response.body.prescriptionId;
    expect(editedPrescriptionId).not.toBe(prescriptionId);

    const after = await request(app).get(`/api/medical-records/${recordId}/events`);
    expect(after.body).toHaveLength(before.body.length + 2);
    expect(after.body.slice(-2).map((event: { type: string }) => event.type)).toEqual([
      'PRESCRIPTION_REMOVED',
      'PRESCRIPTION_ADDED',
    ]);

    const state = await request(app).get(`/api/medical-records/${recordId}`);
    expect(state.body.prescriptions).toEqual([
      { prescriptionId: editedPrescriptionId, text: 'Take two tablets daily' },
    ]);
  });

  it('removes an active prescription and rejects another removal', async () => {
    const removeResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/prescriptions/${editedPrescriptionId}`)
      .send({ workerId });
    expect(removeResponse.status).toBe(200);

    const state = await request(app).get(`/api/medical-records/${recordId}`);
    expect(state.body.prescriptions).toEqual([]);

    const inactiveResponse = await request(app)
      .delete(`/api/medical-records/${recordId}/prescriptions/${editedPrescriptionId}`)
      .send({ workerId });
    expect(inactiveResponse.status).toBe(409);
  });

  it('serializes concurrent event version allocation', async () => {
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/medical-records/${recordId}/prescriptions`)
        .send({ workerId, text: 'Concurrent prescription one' }),
      request(app)
        .post(`/api/medical-records/${recordId}/prescriptions`)
        .send({ workerId, text: 'Concurrent prescription two' }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect([first.body.version, second.body.version].sort((a, b) => a - b)).toEqual([
      Math.min(first.body.version, second.body.version),
      Math.min(first.body.version, second.body.version) + 1,
    ]);
  });

  it('returns ordered event versions and worker details', async () => {
    const response = await request(app).get(`/api/medical-records/${recordId}/events`);

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
      .send({});
    const historicalRecordId = recordResponse.body.id;
    recordIds.push(historicalRecordId);

    await request(app)
      .post(`/api/medical-records/${historicalRecordId}/diagnoses`)
      .send({ workerId, diagnosisId });
    const prescriptionResponse = await request(app)
      .post(`/api/medical-records/${historicalRecordId}/prescriptions`)
      .send({ workerId, text: 'Historical prescription' });
    await request(app)
      .delete(`/api/medical-records/${historicalRecordId}/diagnoses/${diagnosisId}`)
      .send({ workerId });

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
    );
    expect(firstState.body.diagnoses).toHaveLength(1);
    expect(firstState.body.prescriptions).toEqual([]);

    const secondState = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=${encodeURIComponent(times[1].toISOString())}`,
    );
    expect(secondState.body.diagnoses).toHaveLength(1);
    expect(secondState.body.prescriptions).toEqual([
      expect.objectContaining({ prescriptionId: prescriptionResponse.body.prescriptionId }),
    ]);

    const finalState = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=${encodeURIComponent(times[2].toISOString())}`,
    );
    expect(finalState.body.diagnoses).toEqual([]);
    expect(finalState.body.prescriptions).toHaveLength(1);

    const invalidTimestamp = await request(app).get(
      `/api/medical-records/${historicalRecordId}?at=not-a-date`,
    );
    expect(invalidTimestamp.status).toBe(400);
  });

  it('keeps deleted workers readable in history but blocks new modifications', async () => {
    const deleteWorker = await request(app).delete(`/api/medical-workers/${workerId}`);
    expect(deleteWorker.status).toBe(204);

    const events = await request(app).get(`/api/medical-records/${recordId}/events`);
    expect(events.status).toBe(200);
    expect(events.body[0].worker).toMatchObject({ id: workerId, isDeleted: true });

    const modification = await request(app)
      .post(`/api/medical-records/${recordId}/prescriptions`)
      .send({ workerId, text: 'Must be rejected' });
    expect(modification.status).toBe(409);
  });
});
