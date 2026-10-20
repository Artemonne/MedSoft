import { randomUUID, timingSafeEqual } from 'node:crypto';
import { MedicalWorkerRole, RefreshSessionSubjectType, type Prisma } from '@prisma/client';
import { UnauthorizedError } from '../lib/app-error.js';
import { lockAccount } from '../lib/account-sessions.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { hashRefreshToken, issueTokenPair, verifyToken } from '../lib/jwt.js';
import type { LoginInput } from '../schemas/auth.js';
import type { UserAuthContext } from '../types/auth.js';

const prismaRoleToApi = {
  [MedicalWorkerRole.DOCTOR]: 'doctor',
  [MedicalWorkerRole.LABORATORY_TECHNICIAN]: 'laboratory-technician',
  [MedicalWorkerRole.NURSE]: 'nurse',
  [MedicalWorkerRole.OTHER]: 'other',
} as const;

type AccountWithWorker = {
  id: string;
  username: string;
  isActive: boolean;
  medicalWorker: {
    id: number;
    firstName: string;
    lastName: string;
    position: string;
    role: MedicalWorkerRole;
    isDeleted: boolean;
  } | null;
};

function isUsableAccount(
  account: AccountWithWorker | null,
): account is AccountWithWorker & { medicalWorker: NonNullable<AccountWithWorker['medicalWorker']> } {
  return Boolean(account?.isActive && account.medicalWorker && !account.medicalWorker.isDeleted);
}

function publicAccount(
  account: AccountWithWorker & { medicalWorker: NonNullable<AccountWithWorker['medicalWorker']> },
) {
  return {
    id: account.id,
    username: account.username,
    isActive: account.isActive,
    medicalWorker: {
      id: account.medicalWorker.id,
      firstName: account.medicalWorker.firstName,
      lastName: account.medicalWorker.lastName,
      position: account.medicalWorker.position,
      role: prismaRoleToApi[account.medicalWorker.role],
    },
  };
}

function authContext(
  account: AccountWithWorker & { medicalWorker: NonNullable<AccountWithWorker['medicalWorker']> },
  sessionId: string,
): UserAuthContext {
  return {
    subjectType: 'user',
    accountId: account.id,
    username: account.username,
    sessionId,
    medicalWorker: {
      id: account.medicalWorker.id,
      role: account.medicalWorker.role,
    },
  };
}

function hashesMatch(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, 'utf8');
  const secondBuffer = Buffer.from(second, 'utf8');
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

async function revokeFamily(
  transaction: Prisma.TransactionClient,
  familyId: string,
  reason: string,
  revokedAt: Date,
) {
  await transaction.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt, revocationReason: reason },
  });
}

export const authService = {
  async login(input: LoginInput) {
    const account = await prisma.account.findUnique({
      where: { username: input.username },
      omit: { passwordHash: false },
      include: { medicalWorker: true },
    });

    if (!account) {
      await hashPassword(input.password);
      throw new UnauthorizedError('Invalid credentials.');
    }

    const passwordMatches = await verifyPassword(input.password, account.passwordHash);
    if (!passwordMatches || !isUsableAccount(account)) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const issuedAt = new Date();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const tokens = await issueTokenPair({
      subjectId: account.id,
      subjectType: 'user',
      sessionId,
      issuedAt,
    });

    const lockedAccount = await prisma.$transaction(async (transaction) => {
      if (!(await lockAccount(transaction, account.id))) {
        throw new UnauthorizedError('Invalid credentials.');
      }
      const current = await transaction.account.findUnique({
        where: { id: account.id },
        omit: { passwordHash: false },
        include: { medicalWorker: true },
      });
      if (
        !isUsableAccount(current) ||
        current.passwordHash !== account.passwordHash
      ) {
        throw new UnauthorizedError('Invalid credentials.');
      }
      await transaction.refreshSession.create({
        data: {
          id: sessionId,
          subjectType: RefreshSessionSubjectType.USER,
          accountId: current.id,
          tokenHash: hashRefreshToken(tokens.refreshToken),
          familyId,
          issuedAt,
          expiresAt: tokens.refreshTokenExpiresAt,
        },
      });
      return current;
    });

    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenTtlSeconds,
      refreshToken: tokens.refreshToken,
      account: publicAccount(lockedAccount),
    };
  },

  async refresh(refreshToken: string) {
    const claims = await verifyToken(refreshToken, 'refresh', 'user');
    const replacementId = randomUUID();
    const issuedAt = new Date();
    const replacementTokens = await issueTokenPair({
      subjectId: claims.subjectId,
      subjectType: 'user',
      sessionId: replacementId,
      issuedAt,
    });
    const presentedHash = hashRefreshToken(refreshToken);

    const result = await prisma.$transaction(async (transaction) => {
      if (!(await lockAccount(transaction, claims.subjectId))) {
        return { status: 'invalid' as const };
      }
      const session = await transaction.refreshSession.findUnique({
        where: { id: claims.sessionId },
        omit: { tokenHash: false },
        include: { account: { include: { medicalWorker: true } } },
      });

      if (
        !session ||
        session.subjectType !== RefreshSessionSubjectType.USER ||
        session.accountId !== claims.subjectId ||
        !hashesMatch(session.tokenHash, presentedHash)
      ) {
        return { status: 'invalid' as const };
      }

      if (session.revokedAt || session.replacedById) {
        await revokeFamily(transaction, session.familyId, 'reuse-detected', issuedAt);
        return { status: 'reused' as const };
      }

      if (session.expiresAt <= issuedAt || !isUsableAccount(session.account)) {
        await revokeFamily(transaction, session.familyId, 'subject-unavailable', issuedAt);
        return { status: 'invalid' as const };
      }

      const claimed = await transaction.refreshSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          replacedById: null,
          expiresAt: { gt: issuedAt },
        },
        data: { revokedAt: issuedAt, revocationReason: 'rotated' },
      });

      if (claimed.count !== 1) {
        await revokeFamily(transaction, session.familyId, 'reuse-detected', issuedAt);
        return { status: 'reused' as const };
      }

      await transaction.refreshSession.create({
        data: {
          id: replacementId,
          subjectType: RefreshSessionSubjectType.USER,
          accountId: session.account.id,
          tokenHash: hashRefreshToken(replacementTokens.refreshToken),
          familyId: session.familyId,
          issuedAt,
          expiresAt: replacementTokens.refreshTokenExpiresAt,
        },
      });
      await transaction.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: replacementId },
      });

      return { status: 'rotated' as const, account: session.account };
    });

    if (result.status !== 'rotated') {
      throw new UnauthorizedError(
        result.status === 'reused' ? 'Refresh token reuse detected.' : 'Invalid refresh token.',
      );
    }

    return {
      accessToken: replacementTokens.accessToken,
      accessTokenExpiresIn: replacementTokens.accessTokenTtlSeconds,
      refreshToken: replacementTokens.refreshToken,
      account: publicAccount(result.account),
    };
  },

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }

    try {
      const claims = await verifyToken(refreshToken, 'refresh', 'user');
      const tokenHash = hashRefreshToken(refreshToken);
      const session = await prisma.refreshSession.findUnique({
        where: { id: claims.sessionId },
        omit: { tokenHash: false },
      });

      if (
        session?.accountId === claims.subjectId &&
        session.subjectType === RefreshSessionSubjectType.USER &&
        hashesMatch(session.tokenHash, tokenHash)
      ) {
        await prisma.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'logout' },
        });
      }
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
    }
  },

  async authenticateAccessToken(accessToken: string): Promise<UserAuthContext> {
    const claims = await verifyToken(accessToken, 'access', 'user');
    const session = await prisma.refreshSession.findUnique({
      where: { id: claims.sessionId },
      include: { account: { include: { medicalWorker: true } } },
    });

    if (
      !session ||
      session.subjectType !== RefreshSessionSubjectType.USER ||
      session.accountId !== claims.subjectId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !isUsableAccount(session.account)
    ) {
      throw new UnauthorizedError('Authentication session is not active.');
    }

    return authContext(session.account, session.id);
  },

  async currentAccount(context: UserAuthContext) {
    const account = await prisma.account.findUnique({
      where: { id: context.accountId },
      include: { medicalWorker: true },
    });

    if (!isUsableAccount(account)) {
      throw new UnauthorizedError('Account is not active.');
    }
    return publicAccount(account);
  },
};
