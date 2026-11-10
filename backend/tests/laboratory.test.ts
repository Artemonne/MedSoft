import { randomUUID } from 'node:crypto';
import { LabResultKind, MedicalWorkerRole, Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { laboratoryService } from '../src/services/laboratory.js';
import { auditService } from '../src/services/audit.js';
import type { UserAuthContext } from '../src/types/auth.js';
import { bearer, createAuthorizationFixture, type TestUserIdentity } from './helpers/auth-fixture.js';

const textTest = { name: 'Qualitative test', loincCode: '9999-1', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Test method' };
const quantityTest = { name: 'Quantitative test', loincCode: '9998-3', resultKind: LabResultKind.QUANTITY, unitCode: 'mg/dL', unitDisplay: 'mg/dL', methodDescription: null };

describe('laboratory catalog, orders and results', () => {
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>;
  let doctor: TestUserIdentity;
  let nurse: TestUserIdentity;
  let technician: TestUserIdentity;
  let otherWorker: TestUserIdentity;
  let patientId: number;
  let medicalRecordId: number;

  beforeAll(async () => {
    fixture = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE, MedicalWorkerRole.LABORATORY_TECHNICIAN, MedicalWorkerRole.OTHER], true);
    doctor = fixture.users.get(MedicalWorkerRole.DOCTOR)!;
    nurse = fixture.users.get(MedicalWorkerRole.NURSE)!;
    technician = fixture.users.get(MedicalWorkerRole.LABORATORY_TECHNICIAN)!;
    otherWorker = fixture.users.get(MedicalWorkerRole.OTHER)!;
    const patient = await prisma.patient.create({ data: { firstName: 'Lab', lastName: 'Patient', birthDate: new Date('1990-01-01'), medicalRecord: { create: {} } }, include: { medicalRecord: true } });
    patientId = patient.id; medicalRecordId = patient.medicalRecord!.id;
  });

  beforeEach(async () => {
    await prisma.labResult.deleteMany();
    await prisma.labOrder.deleteMany();
    await prisma.labOrderBatch.deleteMany();
    await prisma.labTest.deleteMany();
    await prisma.auditEvent.deleteMany({ where: { eventType: { startsWith: 'LAB_' } } });
    await prisma.medicalRecord.update({ where: { id: medicalRecordId }, data: { isEditingLocked: false } });
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
    await prisma.medicalRecord.update({ where: { id: medicalRecordId }, data: { isEditingLocked: false } });
    const second = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    expect(first.id).not.toBe(second.id); expect(first.orders[0].id).not.toBe(second.orders[0].id);
    await prisma.labTest.update({ where: { id: test.id }, data: { name: 'Changed later', isActive: false } });
    const stored = await prisma.labOrder.findUniqueOrThrow({ where: { id: first.orders[0].id }, include: { batch: { include: { medicalRecord: true, requester: true } }, labTest: true } });
    expect(stored.testNameSnapshot).toBe(textTest.name); expect(stored.labTest.name).toBe('Changed later'); expect(stored.batch.medicalRecordId).toBe(medicalRecordId); expect(stored.batch.requesterId).toBe(doctor.workerId);
  });

  it('creates several orders through the EMR endpoint, relocks the record and writes one audit event', async () => {
    const text = await prisma.labTest.create({ data: textTest });
    const quantity = await prisma.labTest.create({ data: quantityTest });
    const clientRequestId = randomUUID();
    const response = await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [text.id, quantity.id], clientRequestId }).expect(201);
    expect(response.body.orders).toHaveLength(2);
    expect(new Set(response.body.orders.map((item: { id: string }) => item.id)).size).toBe(2);
    expect((await prisma.medicalRecord.findUniqueOrThrow({ where: { id: medicalRecordId } })).isEditingLocked).toBe(true);
    expect(await prisma.auditEvent.count({ where: { eventType: 'LAB_ORDERS_CREATED' } })).toBe(1);
    const replay = await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [text.id, quantity.id], clientRequestId }).expect(201);
    expect(replay.body.id).toBe(response.body.id);
    expect(await prisma.labOrderBatch.count()).toBe(1);
  });

  it('rejects invalid, inactive and unauthorized EMR laboratory order requests', async () => {
    const test = await prisma.labTest.create({ data: { ...textTest, isActive: false } });
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [], clientRequestId: randomUUID() }).expect(400);
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(400);
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(nurse.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(403);
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(technician.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(403);
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(otherWorker.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(403);
  });

  it('rejects locked and missing records and rolls back the batch when audit persistence fails', async () => {
    const test = await prisma.labTest.create({ data: textTest });
    await prisma.medicalRecord.update({ where: { id: medicalRecordId }, data: { isEditingLocked: true } });
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(409);
    await request(app).post('/api/medical-records/2147483647/lab-orders').set(bearer(doctor.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(404);
    await prisma.medicalRecord.update({ where: { id: medicalRecordId }, data: { isEditingLocked: false } });
    const spy = vi.spyOn(auditService, 'record').mockRejectedValueOnce(new Error('audit unavailable'));
    await request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [test.id], clientRequestId: randomUUID() }).expect(500);
    spy.mockRestore();
    expect(await prisma.labOrderBatch.count()).toBe(0);
    expect((await prisma.medicalRecord.findUniqueOrThrow({ where: { id: medicalRecordId } })).isEditingLocked).toBe(false);
  });

  it('collapses concurrent identical requests into one batch', async () => {
    const test = await prisma.labTest.create({ data: textTest }); const clientRequestId = randomUUID();
    const responses = await Promise.all([1, 2].map(() => request(app).post(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).send({ labTestIds: [test.id], clientRequestId })));
    expect(responses.map((item) => item.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(await prisma.labOrderBatch.count()).toBe(1);
  });

  it('lists snapshot data and applies historical result visibility by registration time', async () => {
    const test = await prisma.labTest.create({ data: textTest });
    const batch = await laboratoryService.createOrderBatch(doctorActor(), { medicalRecordId, labTestIds: [test.id], idempotencyKey: randomUUID() });
    const historicalAt = new Date(batch.orders[0].orderedAt.getTime() + 60_000);
    const result = await prisma.labResult.create({ data: { labOrderId: batch.orders[0].id, resultKind: 'TEXT', textValue: 'negative', effectiveAt: historicalAt, registeredAt: new Date(historicalAt.getTime() + 60_000) } });
    const current = await request(app).get(`/api/medical-records/${medicalRecordId}/lab-orders`).set(bearer(doctor.accessToken)).expect(200);
    expect(current.body[0]).toMatchObject({ name: textTest.name, loincCode: textTest.loincCode, status: 'completed', result: { id: result.id, textValue: 'negative' } });
    const historical = await request(app).get(`/api/medical-records/${medicalRecordId}/lab-orders?at=${encodeURIComponent(historicalAt.toISOString())}`).set(bearer(doctor.accessToken)).expect(200);
    expect(historical.body[0]).toMatchObject({ status: 'pending', result: null });
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
