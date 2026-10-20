import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const workerIds: number[] = [];
const diagnosisIds: number[] = [];
const patientIds: number[] = [];

afterAll(async () => {
  await prisma.medicalWorker.deleteMany({ where: { id: { in: workerIds } } });
  await prisma.diagnosis.deleteMany({ where: { id: { in: diagnosisIds } } });
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  await prisma.$disconnect();
});

describe('medical worker CRUD', () => {
  let workerId: number;

  it('creates a worker', async () => {
    const response = await request(app).post('/api/medical-workers').send({
      firstName: 'Maria',
      lastName: 'Petrova',
      position: 'Doctor',
      role: 'laboratory-technician',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      firstName: 'Maria',
      lastName: 'Petrova',
      position: 'Doctor',
      role: 'laboratory-technician',
      isDeleted: false,
    });

    workerId = response.body.id;
    workerIds.push(workerId);
  });

  it('lists the created worker', async () => {
    const response = await request(app).get('/api/medical-workers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: workerId })]));
  });

  it('gets the worker by id', async () => {
    const response = await request(app).get(`/api/medical-workers/${workerId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(workerId);
  });

  it('updates all editable worker fields', async () => {
    const response = await request(app).put(`/api/medical-workers/${workerId}`).send({
      firstName: 'Elena',
      lastName: 'Sidorova',
      position: 'Surgeon',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: workerId,
      firstName: 'Elena',
      lastName: 'Sidorova',
      position: 'Surgeon',
      role: 'laboratory-technician',
    });
  });

  it('accepts one-character first and last names and defaults the role', async () => {
    const response = await request(app).post('/api/medical-workers').send({
      firstName: 'A',
      lastName: 'B',
      position: 'Nurse',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ firstName: 'A', lastName: 'B', role: 'other' });
    workerIds.push(response.body.id);
  });

  it('rejects an empty name without weakening the position constraint', async () => {
    const response = await request(app).post('/api/medical-workers').send({
      firstName: '',
      lastName: 'Petrova',
      position: 'Doctor',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const shortPositionResponse = await request(app).post('/api/medical-workers').send({
      firstName: 'A',
      lastName: 'B',
      position: 'RN',
    });
    expect(shortPositionResponse.status).toBe(400);
  });

  it('rejects an unsupported API role', async () => {
    const response = await request(app).post('/api/medical-workers').send({
      firstName: 'Anna',
      lastName: 'Petrova',
      position: 'Doctor',
      role: 'laboratory_technician',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('soft deletes the worker and hides it from normal reads', async () => {
    const deleteResponse = await request(app).delete(`/api/medical-workers/${workerId}`);
    expect(deleteResponse.status).toBe(204);

    const row = await prisma.medicalWorker.findUnique({ where: { id: workerId } });
    expect(row?.isDeleted).toBe(true);

    const getResponse = await request(app).get(`/api/medical-workers/${workerId}`);
    expect(getResponse.status).toBe(404);

    const listResponse = await request(app).get('/api/medical-workers');
    expect(listResponse.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workerId })]),
    );
  });
});

describe('diagnosis CRUD', () => {
  let diagnosisId: number;
  const code = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  const otherCode = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  const name = `Dx ${randomUUID().slice(0, 8)}`;
  const updatedName = `Dx ${randomUUID().slice(0, 8)}`;

  it('creates a diagnosis', async () => {
    const response = await request(app).post('/api/diagnoses').send({ code, name });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ code, name });

    diagnosisId = response.body.id;
    diagnosisIds.push(diagnosisId);
  });

  it('loads the initial diagnosis catalog idempotently', async () => {
    const codes = ['J00001', 'I10001', 'E11901', 'K29001', 'M54501'];
    const existing = await prisma.diagnosis.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });

    const firstResponse = await request(app).post('/api/diagnoses/seed');
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toMatchObject({
      created: codes.length - existing.length,
      total: codes.length,
    });

    const loaded = await prisma.diagnosis.findMany({ where: { code: { in: codes } } });
    expect(loaded).toHaveLength(codes.length);
    diagnosisIds.push(
      ...loaded.filter((item) => !existing.some((row) => row.id === item.id)).map((item) => item.id),
    );

    const secondResponse = await request(app).post('/api/diagnoses/seed');
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toEqual({ created: 0, total: codes.length });
  });

  it('gets the diagnosis by id', async () => {
    const response = await request(app).get(`/api/diagnoses/${diagnosisId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: diagnosisId, code, name });
  });

  it('updates the diagnosis', async () => {
    const response = await request(app)
      .put(`/api/diagnoses/${diagnosisId}`)
      .send({ code, name: updatedName });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: diagnosisId, code, name: updatedName });
  });

  it('rejects a code whose length is not six', async () => {
    const response = await request(app).post('/api/diagnoses').send({
      code: 'ABC',
      name: 'Valid name',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a diagnosis name shorter than three characters', async () => {
    const response = await request(app).post('/api/diagnoses').send({
      code: otherCode,
      name: 'AB',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns conflict for a duplicate code', async () => {
    const response = await request(app).post('/api/diagnoses').send({
      code,
      name: `Dx ${randomUUID().slice(0, 8)}`,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('returns conflict for a duplicate name', async () => {
    const response = await request(app).post('/api/diagnoses').send({
      code: otherCode,
      name: updatedName,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('deletes the diagnosis', async () => {
    const deleteResponse = await request(app).delete(`/api/diagnoses/${diagnosisId}`);
    expect(deleteResponse.status).toBe(204);

    const getResponse = await request(app).get(`/api/diagnoses/${diagnosisId}`);
    expect(getResponse.status).toBe(404);
  });
});

describe('patient CRUD', () => {
  let patientId: number;

  it('creates a patient', async () => {
    const response = await request(app).post('/api/patients').send({
      firstName: 'Alex',
      lastName: 'Ivanov',
      middleName: 'Sergeevich',
      birthDate: '1990-01-02',
      sex: 'MALE',
      comment: 'Initial visit',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      firstName: 'Alex',
      lastName: 'Ivanov',
      middleName: 'Sergeevich',
      sex: 'MALE',
      comment: 'Initial visit',
    });

    patientId = response.body.id;
    patientIds.push(patientId);
  });

  it('lists the created patient', async () => {
    const response = await request(app).get('/api/patients');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: patientId })]));
  });

  it('gets the patient by id', async () => {
    const response = await request(app).get(`/api/patients/${patientId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(patientId);
  });

  it('updates all editable patient fields', async () => {
    const response = await request(app).put(`/api/patients/${patientId}`).send({
      firstName: 'Anna',
      lastName: 'Ivanova',
      birthDate: '1991-03-04',
      sex: 'FEMALE',
      comment: null,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: patientId,
      firstName: 'Anna',
      lastName: 'Ivanova',
      middleName: null,
      sex: 'FEMALE',
      comment: null,
    });
  });

  it('rejects an invalid sex value', async () => {
    const response = await request(app).post('/api/patients').send({
      firstName: 'Alex',
      lastName: 'Ivanov',
      birthDate: '1990-01-02',
      sex: 'OTHER',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a comment longer than 32 characters', async () => {
    const response = await request(app).post('/api/patients').send({
      firstName: 'Alex',
      lastName: 'Ivanov',
      birthDate: '1990-01-02',
      sex: 'UNKNOWN',
      comment: 'x'.repeat(33),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a future birth date', async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const response = await request(app).post('/api/patients').send({
      firstName: 'Alex',
      lastName: 'Ivanov',
      birthDate: tomorrow.toISOString().slice(0, 10),
      sex: 'UNKNOWN',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('physically deletes a patient without a medical record', async () => {
    const deleteResponse = await request(app).delete(`/api/patients/${patientId}`);
    expect(deleteResponse.status).toBe(204);

    const row = await prisma.patient.findUnique({ where: { id: patientId } });
    expect(row).toBeNull();
  });
});
