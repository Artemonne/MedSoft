import { createHash } from 'node:crypto';
import { LabResultKind, Prisma } from '@prisma/client';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { CreateLabOrderBatchInput, CreateLabResultInput } from '../schemas/laboratory.js';
import type { ServiceAuthContext, UserAuthContext } from '../types/auth.js';
import { auditService } from './audit.js';

const batchInclude = { orders: { orderBy: { orderedAt: 'asc' as const } } };
const resultOrderInclude = { result: true, batch: { include: { medicalRecord: true } } } as const;
type ServiceOrder = Prisma.LabOrderGetPayload<{ include: typeof resultOrderInclude }>;

type ServiceResultInput = CreateLabResultInput & {
  identifier: { system: string; value: string };
  patientId: number;
  loincCode: string;
  conditional: boolean;
};

function resultData(labOrderId: string, input: CreateLabResultInput): Prisma.LabResultUncheckedCreateInput {
  return input.resultKind === LabResultKind.TEXT
    ? { labOrderId, resultKind: LabResultKind.TEXT, textValue: input.textValue, effectiveAt: input.effectiveAt }
    : { labOrderId, resultKind: LabResultKind.QUANTITY, quantityValue: new Prisma.Decimal(input.quantityValue), unitCode: input.unitCode, effectiveAt: input.effectiveAt };
}

function validateServiceSubmission(order: ServiceOrder, input: ServiceResultInput) {
  if (order.batch.medicalRecord.patientId !== input.patientId) throw new ConflictError('Observation subject does not match the ServiceRequest patient.');
  if (order.loincCodeSnapshot !== input.loincCode) throw new ConflictError('Observation LOINC code does not match the ServiceRequest.');
  if (order.resultKindSnapshot !== input.resultKind) throw new ConflictError('Observation value type does not match the ServiceRequest.');
  if (input.resultKind === LabResultKind.QUANTITY && input.unitCode !== order.unitCodeSnapshot) throw new ConflictError('Observation UCUM unit does not match the ServiceRequest snapshot.');
}

function sameResult(existing: any, input: ServiceResultInput) {
  if (existing.effectiveAt.getTime() !== input.effectiveAt.getTime() || existing.resultKind !== input.resultKind) return false;
  return input.resultKind === LabResultKind.TEXT
    ? existing.textValue === input.textValue
    : new Prisma.Decimal(existing.quantityValue).equals(new Prisma.Decimal(input.quantityValue)) && existing.unitCode === input.unitCode;
}

function hashBatch(input: CreateLabOrderBatchInput): string {
  return createHash('sha256').update(JSON.stringify({ medicalRecordId: input.medicalRecordId, labTestIds: [...input.labTestIds].sort((a, b) => a - b) })).digest('hex');
}

export const laboratoryService = {
  async createOrderBatch(actor: UserAuthContext, input: CreateLabOrderBatchInput) {
    if (actor.medicalWorker.role !== 'DOCTOR') throw new ForbiddenError('Only a doctor can create laboratory orders.');
    if (new Set(input.labTestIds).size !== input.labTestIds.length) throw new AppError(400, 'DUPLICATE_LAB_TEST', 'A laboratory test may occur only once in one batch.');
    const requestHash = hashBatch(input);
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.accountId}:${input.idempotencyKey}`}, 0))::text`;
      const existing = await transaction.labOrderBatch.findUnique({ where: { createdByAccountId_idempotencyKey: { createdByAccountId: actor.accountId, idempotencyKey: input.idempotencyKey } }, include: batchInclude });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictError('The idempotency key was already used for different laboratory orders.');
        return existing;
      }
      const record = await transaction.medicalRecord.findUnique({ where: { id: input.medicalRecordId }, select: { id: true } });
      if (!record) throw new NotFoundError('Medical record');
      const tests = await transaction.labTest.findMany({ where: { id: { in: input.labTestIds }, isActive: true } });
      if (tests.length !== input.labTestIds.length) throw new AppError(400, 'INVALID_LAB_TEST', 'Every laboratory test must exist and be active.');
      const byId = new Map(tests.map((item) => [item.id, item]));
      return transaction.labOrderBatch.create({
        data: {
          medicalRecordId: input.medicalRecordId,
          requesterId: actor.medicalWorker.id,
          createdByAccountId: actor.accountId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          orders: { create: input.labTestIds.map((id) => { const test = byId.get(id)!; return { labTestId: test.id, testNameSnapshot: test.name, loincCodeSnapshot: test.loincCode, resultKindSnapshot: test.resultKind, unitCodeSnapshot: test.unitCode, unitDisplaySnapshot: test.unitDisplay, methodDescriptionSnapshot: test.methodDescription }; }) },
        },
        include: batchInclude,
      });
    });
  },

  async createResult(labOrderId: string, input: CreateLabResultInput) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${labOrderId}, 0))::text`;
      const order = await transaction.labOrder.findUnique({ where: { id: labOrderId }, include: { result: true } });
      if (!order) throw new NotFoundError('Laboratory order');
      if (order.result) throw new ConflictError('A result already exists for this laboratory order.');
      if (order.resultKindSnapshot !== input.resultKind) throw new AppError(400, 'RESULT_KIND_MISMATCH', 'Result kind does not match the laboratory order.');
      if (input.resultKind === LabResultKind.QUANTITY && input.unitCode !== order.unitCodeSnapshot) throw new AppError(400, 'RESULT_UNIT_MISMATCH', 'Result unit does not match the laboratory order snapshot.');
      return transaction.labResult.create({ data: resultData(labOrderId, input) });
    });
  },

  async createServiceResult(actor: ServiceAuthContext, labOrderId: string, input: ServiceResultInput) {
    return prisma.$transaction(async (transaction) => {
      const identifierLock = `${input.identifier.system}|${input.identifier.value}`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lab-result-identifier:${identifierLock}`}, 0))::text`;
      const existing = await transaction.labResult.findUnique({ where: { identifierSystem_identifierValue: { identifierSystem: input.identifier.system, identifierValue: input.identifier.value } }, include: { labOrder: { include: resultOrderInclude } } });
      if (existing) {
        if (!input.conditional) throw new ConflictError('Observation identifier already exists.');
        validateServiceSubmission(existing.labOrder, input);
        if (existing.labOrderId !== labOrderId || !sameResult(existing, input)) throw new ConflictError('Existing Observation does not match the submitted clinical data.');
        return { result: existing, created: false as const };
      }
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${labOrderId}, 0))::text`;
      const order = await transaction.labOrder.findUnique({ where: { id: labOrderId }, include: resultOrderInclude });
      if (!order) throw new NotFoundError('Laboratory order');
      validateServiceSubmission(order, input);
      if (order.result) throw new ConflictError('A result already exists for this ServiceRequest.');
      const result = await transaction.labResult.create({ data: { ...resultData(labOrderId, input), identifierSystem: input.identifier.system, identifierValue: input.identifier.value, createdByServiceAccountId: actor.serviceAccountId } });
      await auditService.record(transaction, { eventType: 'LAB_RESULT_CREATED', actor: { type: 'service', serviceAccountId: actor.serviceAccountId }, message: `Laboratory result ${result.id} created.`, metadata: { labResultId: result.id, labOrderId, operation: 'fhir-observation-create' } });
      return { result, created: true as const };
    });
  },
};
