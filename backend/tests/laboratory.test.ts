import { randomUUID } from 'node:crypto';
import { LabResultKind, MedicalWorkerRole, Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { laboratoryService } from '../src/services/laboratory.js';
import type { UserAuthContext } from '../src/types/auth.js';
import { bearer, createAuthorizationFixture, type TestUserIdentity } from './helpers/auth-fixture.js';

const textTest = { name: 'Qualitative test', loincCode: '9999-1', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Test method' };
const quantityTest = { name: 'Quantitative test', loincCode: '9998-3', resultKind: LabResultKind.QUANTITY, unitCode: 'mg/dL', unitDisplay: 'mg/dL', methodDescription: null };

describe('laboratory catalog, orders and results', () => {
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let doctor: TestUserIdentity;
  let nurse: TestUserIdentity;
  let patientId: number;
  let medicalRecordId: number;

  beforeAll(async () => {
    fixture = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE], true);
    doctor = fixture.users.get(MedicalWorkerRole.DOCTOR)!;
    nurse = fixture.users.get(MedicalWorkerRole.NURSE)!;
    const patient = await prisma.patient.create({ data: { firstName: 'Lab', lastName: 'Patient', birthDate: new Date('1990-01-01'), medicalRecord: { create: {} } }, include: { medicalRecord: true } });
    patientId = patient.id; medicalRecordId = patient.medicalRecord!.id;
  });

  beforeEach(async () => {
    await prisma.labResult.deleteMany();
    await prisma.labOrder.deleteMany();
    await prisma.labOrderBatch.deleteMany();
    await prisma.labTest.deleteMany();
    await prisma.auditEvent.deleteMany({ where: { eventType: { startsWith: 'LAB_TEST' } } });
  });

  afterAll(async () => {
    await prisma.labResult.deleteMany(); await prisma.labOrder.deleteMany(); await prisma.labOrderBatch.deleteMany(); await prisma.labTest.deleteMany();
    await prisma.medicalRecord.delete({ where: { id: medicalRecordId } }); await prisma.patient.delete({ where: { id: patientId } });
    await fixture.cleanup(); await prisma.$disconnect();
  });

  const admin = () => bearer(fixture.adminAccessToken!);
  const doctorActor = (): UserAuthContext => ({ subjectType: 'user', accountId: doctor.accountId, username: doctor.username, sessionId: doctor.sessionId, medicalWorker: { id: doctor.workerId, role: MedicalWorkerRole.DOCTOR } });

  it('allows only an administrator to create, update and deactivate catalog entries', async () => {
    expect((await request(app).post('/api/admin/lab-tests').send(textTest)).status).toBe(401);
    expect((await request(app).post('/api/admin/lab-tests').set(bearer(doctor.accessToken)).send(textTest)).status).toBe(401);
    const created = await request(app).post('/api/admin/lab-tests').set(admin()).send(textTest).expect(201);
    expect(created.body.isActive).toBe(true);
    await request(app).post('/api/admin/lab-tests').set(admin()).send(textTest).expect(409);
    await request(app).put(`/api/admin/lab-tests/${created.body.id}`).set(admin()).send({ ...textTest, name: 'Updated qualitative test' }).expect(200);
    await request(app).patch(`/api/admin/lab-tests/${created.body.id}/active`).set(admin()).send({ isActive: false }).expect(200).expect(({ body }) => expect(body.isActive).toBe(false));
  });

  it('validates result kinds and measurement units', async () => {
    await request(app).post('/api/admin/lab-tests').set(admin()).send({ ...quantityTest, unitCode: null }).expect(400);
    await request(app).post('/api/admin/lab-tests').set(admin()).send({ ...textTest, unitCode: 'mg/dL', unitDisplay: 'mg/dL' }).expect(400);
    await request(app).post('/api/admin/lab-tests').set(admin()).send({ ...textTest, loincCode: 'not-loinc' }).expect(400);
  });

  it('seeds exactly seven verified tests idempotently', async () => {
    await request(app).post('/api/admin/lab-tests/seed').set(admin()).expect(200).expect(({ body }) => expect(body).toEqual({ created: 7, total: 7 }));
    await request(app).post('/api/admin/lab-tests/seed').set(admin()).expect(200).expect(({ body }) => expect(body).toEqual({ created: 0, total: 7 }));
    expect(await prisma.labTest.count()).toBe(7);
  });

  it('creates repeatable one-test orders in a batch and preserves catalog snapshots', async () => {
    const test = await prisma.labTest.create({ data: textTest });
    const first = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    const second = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    expect(first.id).not.toBe(second.id); expect(first.orders[0].id).not.toBe(second.orders[0].id);
    await prisma.labTest.update({ where: { id: test.id }, data: { name: 'Changed later', isActive: false } });
    const stored = await prisma.labOrder.findUniqueOrThrow({ where: { id: first.orders[0].id }, include: { batch: { include: { medicalRecord: true, requester: true } }, labTest: true } });
    expect(stored.testNameSnapshot).toBe(textTest.name); expect(stored.labTest.name).toBe('Changed later'); expect(stored.batch.medicalRecordId).toBe(medicalRecordId); expect(stored.batch.requesterId).toBe(doctor.workerId);
  });

  it('makes batch creation idempotent per account and request content', async () => {
    const test = await prisma.labTest.create({ data: textTest }); const key = randomUUID();
    const first = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: key });
    const replay = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: key });
    expect(replay.id).toBe(first.id); expect(await prisma.labOrderBatch.count()).toBe(1);
    const other = await prisma.labTest.create({ data: quantityTest });
    await expect(laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [other.id], idempotencyKey: key })).rejects.toMatchObject({ status: 409 });
    const nurseActor: UserAuthContext = { subjectType: 'user', accountId: nurse.accountId, username: nurse.username, sessionId: nurse.sessionId, medicalWorker: { id: nurse.workerId, role: MedicalWorkerRole.NURSE } };
    await expect(laboratoryService.createOrderBatch(nurseActor, { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 403 });
  });

  it('stores TEXT and exact QUANTITY results with distinct effective and registration times', async () => {
    const text = await prisma.labTest.create({ data: textTest }); const quantity = await prisma.labTest.create({ data: quantityTest });
    const batch = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [text.id, quantity.id], idempotencyKey: randomUUID() });
    const effectiveAt = new Date('2026-11-01T10:00:00Z');
    const textResult = await laboratoryService.createResult(batch.orders[0].id, { resultKind: 'TEXT', textValue: 'negative', effectiveAt });
    const quantityResult = await laboratoryService.createResult(batch.orders[1].id, { resultKind: 'QUANTITY', quantityValue: '123.456789', unitCode: 'mg/dL', effectiveAt });
    expect(textResult.textValue).toBe('negative'); expect(textResult.registeredAt.getTime()).toBeGreaterThan(effectiveAt.getTime());
    expect(quantityResult.quantityValue).toEqual(new Prisma.Decimal('123.456789')); expect(quantityResult.unitCode).toBe('mg/dL');
  });

  it('allows at most one result per order even for concurrent submissions', async () => {
    const test = await prisma.labTest.create({ data: textTest }); const batch = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    const results = await Promise.allSettled([laboratoryService.createResult(batch.orders[0].id, { resultKind: 'TEXT', textValue: 'first', effectiveAt: new Date() }), laboratoryService.createResult(batch.orders[0].id, { resultKind: 'TEXT', textValue: 'second', effectiveAt: new Date() })]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1); expect(await prisma.labResult.count()).toBe(1);
  });

  it('enforces result value shape and the one-result rule in PostgreSQL', async () => {
    const test = await prisma.labTest.create({ data: textTest }); const batch = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    await expect(prisma.labResult.create({ data: { labOrderId: batch.orders[0].id, resultKind: 'TEXT', textValue: null, effectiveAt: new Date() } })).rejects.toThrow();
    await laboratoryService.createResult(batch.orders[0].id, { resultKind: 'TEXT', textValue: 'negative', effectiveAt: new Date() });
    await expect(prisma.labResult.create({ data: { labOrderId: batch.orders[0].id, resultKind: 'TEXT', textValue: 'duplicate', effectiveAt: new Date() } })).rejects.toThrow();
  });
});
