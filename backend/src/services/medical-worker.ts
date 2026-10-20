import { MedicalWorkerRole, type MedicalWorker } from '@prisma/client';
import { lockAccount, revokeActiveAccountSessions } from '../lib/account-sessions.js';
import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { MedicalWorkerInput } from '../schemas/medical-worker.js';
import { recordAccountManagementChange } from './account-management-audit.js';

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

  async create(data: MedicalWorkerInput) {
    return toApi(await prisma.medicalWorker.create({ data: toPrismaData(data) }));
  },

  async update(id: number, data: MedicalWorkerInput) {
    const result = await prisma.medicalWorker.updateMany({
      where: { id, isDeleted: false },
      data: toPrismaData(data),
    });

    if (result.count === 0) {
      throw new NotFoundError('Medical worker');
    }

    return toApi(await prisma.medicalWorker.findUniqueOrThrow({ where: { id } }));
  },

  async softDelete(id: number) {
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
      if (!account) {
        return;
      }
      await lockAccount(transaction, account.id);
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
