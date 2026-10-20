import { randomInt } from 'node:crypto';
import { MedicalWorkerRole, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../lib/app-error.js';
import { lockAccount, revokeActiveAccountSessions } from '../lib/account-sessions.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import type { AccountRoleInput, CreateAccountInput } from '../schemas/admin-account.js';
import { recordAccountManagementChange } from './account-management-audit.js';

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASSWORD_CHARACTER_GROUPS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
] as const;
const GENERATED_PASSWORD_LENGTH = 12;

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

const accountInclude = { medicalWorker: true } as const;

type AccountWithWorker = Prisma.AccountGetPayload<{ include: typeof accountInclude }>;

function publicAccount(account: AccountWithWorker) {
  return {
    id: account.id,
    username: account.username,
    isActive: account.isActive,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    medicalWorker: account.medicalWorker
      ? {
          id: account.medicalWorker.id,
          firstName: account.medicalWorker.firstName,
          lastName: account.medicalWorker.lastName,
          position: account.medicalWorker.position,
          role: prismaRoleToApi[account.medicalWorker.role],
          isDeleted: account.medicalWorker.isDeleted,
        }
      : null,
  };
}

export function generateMedicalWorkerPassword(): string {
  const characters = PASSWORD_CHARACTER_GROUPS.map(
    (group) => group[randomInt(group.length)],
  );
  while (characters.length < GENERATED_PASSWORD_LENGTH) {
    characters.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

async function findLockedAccount(transaction: Prisma.TransactionClient, accountId: string) {
  if (!(await lockAccount(transaction, accountId))) {
    throw new NotFoundError('Account');
  }
  return transaction.account.findUniqueOrThrow({
    where: { id: accountId },
    include: accountInclude,
  });
}

function accountConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
    if (target.includes('username')) {
      throw new ConflictError('Username is already in use.');
    }
    if (target.includes('medicalWorkerId')) {
      throw new ConflictError('Medical worker already has an account.');
    }
    throw new ConflictError('Account already exists.');
  }
  throw error;
}

export const adminAccountService = {
  async list() {
    const accounts = await prisma.account.findMany({
      include: accountInclude,
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map(publicAccount);
  },

  async create(input: CreateAccountInput, administratorId: 1) {
    const generatedPassword = generateMedicalWorkerPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const occurredAt = new Date();

    try {
      const account = await prisma.$transaction(async (transaction) => {
        const workers = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT "id"
          FROM "MedicalWorker"
          WHERE "id" = ${input.medicalWorkerId} AND "isDeleted" = false
          FOR UPDATE
        `);
        if (workers.length !== 1) {
          throw new NotFoundError('Medical worker');
        }

        const created = await transaction.account.create({
          data: {
            username: input.username,
            passwordHash,
            medicalWorkerId: input.medicalWorkerId,
          },
          include: accountInclude,
        });
        await recordAccountManagementChange(transaction, {
          action: 'account-created',
          actor: { type: 'admin', administratorId },
          accountId: created.id,
          medicalWorkerId: input.medicalWorkerId,
          revokedRefreshTokens: 0,
          occurredAt,
        });
        return created;
      });

      return { account: publicAccount(account), generatedPassword };
    } catch (error) {
      accountConflict(error);
    }
  },

  async resetPassword(accountId: string, administratorId: 1) {
    const generatedPassword = generateMedicalWorkerPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const occurredAt = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      const existing = await findLockedAccount(transaction, accountId);
      if (!existing.medicalWorker) {
        throw new ConflictError('Account is not linked to a medical worker.');
      }
      const account = await transaction.account.update({
        where: { id: accountId },
        data: { passwordHash },
        include: accountInclude,
      });
      const revokedRefreshTokens = await revokeActiveAccountSessions(
        transaction,
        accountId,
        'password-changed',
        occurredAt,
      );
      await recordAccountManagementChange(transaction, {
        action: 'password-changed',
        actor: { type: 'admin', administratorId },
        accountId,
        medicalWorkerId: existing.medicalWorker.id,
        revokedRefreshTokens,
        occurredAt,
      });
      return { account: publicAccount(account), revokedRefreshTokens };
    });
    return { ...result, generatedPassword };
  },

  async setActive(accountId: string, isActive: boolean, administratorId: 1) {
    const occurredAt = new Date();
    return prisma.$transaction(async (transaction) => {
      const existing = await findLockedAccount(transaction, accountId);
      if (!existing.medicalWorker) {
        throw new ConflictError('Account is not linked to a medical worker.');
      }
      const account = await transaction.account.update({
        where: { id: accountId },
        data: { isActive },
        include: accountInclude,
      });
      const revokedRefreshTokens = isActive
        ? 0
        : await revokeActiveAccountSessions(
            transaction,
            accountId,
            'account-deactivated',
            occurredAt,
          );
      await recordAccountManagementChange(transaction, {
        action: 'activation-changed',
        actor: { type: 'admin', administratorId },
        accountId,
        medicalWorkerId: existing.medicalWorker.id,
        revokedRefreshTokens,
        occurredAt,
      });
      return { account: publicAccount(account), revokedRefreshTokens };
    });
  },

  async setRole(accountId: string, input: AccountRoleInput, administratorId: 1) {
    const occurredAt = new Date();
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.account.findUnique({
        where: { id: accountId },
        include: accountInclude,
      });
      if (!existing) {
        throw new NotFoundError('Account');
      }
      if (!existing.medicalWorker) {
        throw new ConflictError('Account is not linked to a medical worker.');
      }

      const workerUpdate = await transaction.medicalWorker.updateMany({
        where: { id: existing.medicalWorker.id, isDeleted: false },
        data: { role: apiRoleToPrisma[input.role] },
      });
      if (workerUpdate.count !== 1) {
        throw new NotFoundError('Medical worker');
      }
      if (!(await lockAccount(transaction, accountId))) {
        throw new NotFoundError('Account');
      }
      await transaction.account.update({
        where: { id: accountId },
        data: { updatedAt: occurredAt },
      });
      const revokedRefreshTokens = await revokeActiveAccountSessions(
        transaction,
        accountId,
        'role-changed',
        occurredAt,
      );
      await recordAccountManagementChange(transaction, {
        action: 'role-changed',
        actor: { type: 'admin', administratorId },
        accountId,
        medicalWorkerId: existing.medicalWorker.id,
        revokedRefreshTokens,
        occurredAt,
      });
      const account = await transaction.account.findUniqueOrThrow({
        where: { id: accountId },
        include: accountInclude,
      });
      return { account: publicAccount(account), revokedRefreshTokens };
    });
  },
};
