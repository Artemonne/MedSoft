import { MedicalWorkerRole, Prisma, type MedicalWorker } from '@prisma/client';
import { lockAccount, revokeActiveAccountSessions } from '../lib/account-sessions.js';
import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { MedicalWorkerInput } from '../schemas/medical-worker.js';
import { recordAccountManagementChange } from './account-management-audit.js';
import { auditService } from './audit.js';

const apiRoleToPrisma = {
  doctor: MedicalWorkerRole.DOCTOR,
  'laboratory-technician': MedicalWorkerRole.LABORATORY_TECHNICIAN,
  nurse: MedicalWorkerRole.NURSE,
  other: MedicalWorkerRole.OTHER,
} as const;

const prismaRoleToApi = {
  [MedicalWorkerRole.DOCTOR]: 'doctor',
  [MedicalWorkerRole.LABORATORY_TECHNICIAN]: 'laboratory-technician',
  [MedicalWorkerRole.NURSE]: 'nurse',
  [MedicalWorkerRole.OTHER]: 'other',
} as const;

function toPrismaData(data: MedicalWorkerInput) {
  const { role, ...fields } = data;
  return role ? { ...fields, role: apiRoleToPrisma[role] } : fields;
}

function toApi(worker: MedicalWorker) {
  return { ...worker, role: prismaRoleToApi[worker.role] };
}

export const medicalWorkerService = {
  async list() {
    const workers = await prisma.medicalWorker.findMany({
      where: { isDeleted: false },
      orderBy: { id: 'asc' },
    });
    return workers.map(toApi);
  },

  async getById(id: number) {
    const worker = await prisma.medicalWorker.findFirst({
      where: { id, isDeleted: false },
    });

    if (!worker) {
      throw new NotFoundError('Medical worker');
    }

    return toApi(worker);
  },

  async create(data: MedicalWorkerInput, administratorId: 1) {
    return prisma.$transaction(async (transaction) => {
      const worker = await transaction.medicalWorker.create({ data: toPrismaData(data) });
      await auditService.record(transaction, {
        eventType: 'MEDICAL_WORKER_CREATED',
        actor: { type: 'admin', administratorId },
        message: 'Medical worker created.',
        metadata: { medicalWorkerId: worker.id },
      });
      return toApi(worker);
    });
  },

  async update(id: number, data: MedicalWorkerInput, administratorId: 1) {
    return prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "MedicalWorker"
        WHERE "id" = ${id} AND "isDeleted" = false
        FOR UPDATE
      `);
      if (rows.length !== 1) {
        throw new NotFoundError('Medical worker');
      }
      const existing = await transaction.medicalWorker.findUniqueOrThrow({
        where: { id },
        include: { account: { select: { id: true } } },
      });
      const roleChanged = Boolean(data.role && apiRoleToPrisma[data.role] !== existing.role);
      const worker = await transaction.medicalWorker.update({
        where: { id },
        data: toPrismaData(data),
      });

      if (roleChanged && existing.account) {
        const occurredAt = new Date();
        await lockAccount(transaction, existing.account.id);
        await transaction.account.update({
          where: { id: existing.account.id },
          data: { updatedAt: occurredAt },
        });
        const revokedRefreshTokens = await revokeActiveAccountSessions(
          transaction,
          existing.account.id,
          'role-changed',
          occurredAt,
        );
        await recordAccountManagementChange(transaction, {
          action: 'role-changed',
          actor: { type: 'admin', administratorId },
          accountId: existing.account.id,
          medicalWorkerId: id,
          revokedRefreshTokens,
          occurredAt,
        });
      }

      await auditService.record(transaction, {
        eventType: 'MEDICAL_WORKER_UPDATED',
        actor: { type: 'admin', administratorId },
        message: 'Medical worker updated.',
        metadata: { medicalWorkerId: id },
      });
      return toApi(worker);
    });
  },

  async softDelete(id: number, administratorId: 1) {
    const occurredAt = new Date();
    await prisma.$transaction(async (transaction) => {
      const result = await transaction.medicalWorker.updateMany({
        where: { id, isDeleted: false },
        data: { isDeleted: true },
      });

      if (result.count === 0) {
        throw new NotFoundError('Medical worker');
      }

      const account = await transaction.account.findUnique({
        where: { medicalWorkerId: id },
        select: { id: true },
      });
      if (account) {
        await lockAccount(transaction, account.id);
      }

      await auditService.record(transaction, {
        eventType: 'MEDICAL_WORKER_DELETED',
        actor: { type: 'admin', administratorId },
        message: 'Medical worker logically deleted.',
        metadata: { medicalWorkerId: id },
      });
      if (!account) {
        return;
      }
      await transaction.account.update({
        where: { id: account.id },
        data: { isActive: false },
      });
      const revokedRefreshTokens = await revokeActiveAccountSessions(
        transaction,
        account.id,
        'medical-worker-deleted',
        occurredAt,
      );
      await recordAccountManagementChange(transaction, {
        action: 'worker-deleted',
        actor: { type: 'system' },
        accountId: account.id,
        medicalWorkerId: id,
        revokedRefreshTokens,
        occurredAt,
      });
    });
  },
};
