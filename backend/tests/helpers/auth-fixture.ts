import { randomUUID } from 'node:crypto';
import {
  AdministratorSetupState,
  MedicalWorkerRole,
  RefreshSessionSubjectType,
} from '@prisma/client';
import { hashRefreshToken, issueTokenPair } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { installTestJwtKeys } from './jwt-keys.js';

export interface TestUserIdentity {
  accountId: string;
  workerId: number;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

async function createUserIdentity(role: MedicalWorkerRole): Promise<TestUserIdentity> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const worker = await prisma.medicalWorker.create({
    data: {
      firstName: 'Auth',
      lastName: role,
      position: 'Test worker',
      role,
    },
  });
  const account = await prisma.account.create({
    data: {
      username: `${role.slice(0, 3).toLowerCase()}${suffix}`,
      passwordHash: 'test-only-password-hash',
      medicalWorkerId: worker.id,
    },
  });
  const issuedAt = new Date();
  const sessionId = randomUUID();
  const tokens = await issueTokenPair({
    subjectId: account.id,
    subjectType: 'user',
    sessionId,
    issuedAt,
  });
  await prisma.refreshSession.create({
    data: {
      id: sessionId,
      subjectType: RefreshSessionSubjectType.USER,
      accountId: account.id,
      tokenHash: hashRefreshToken(tokens.refreshToken),
      familyId: randomUUID(),
      issuedAt,
      expiresAt: tokens.refreshTokenExpiresAt,
    },
  });
  return {
    accountId: account.id,
    workerId: worker.id,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId,
  };
}

export async function createAuthorizationFixture(
  roles: MedicalWorkerRole[],
  includeAdministrator = false,
) {
  const jwtKeys = installTestJwtKeys();
  const users = new Map<MedicalWorkerRole, TestUserIdentity>();
  for (const role of roles) {
    users.set(role, await createUserIdentity(role));
  }

  let adminAccessToken: string | undefined;
  if (includeAdministrator) {
    await prisma.refreshSession.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.auditEvent.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
    await prisma.systemAdministrator.create({
      data: {
        id: 1,
        passwordHash: 'test-only-password-hash',
        totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        setupState: AdministratorSetupState.ACTIVE,
      },
    });
    const issuedAt = new Date();
    const sessionId = randomUUID();
    const tokens = await issueTokenPair({
      subjectId: 'system-administrator:1',
      subjectType: 'admin',
      sessionId,
      issuedAt,
    });
    await prisma.refreshSession.create({
      data: {
        id: sessionId,
        subjectType: RefreshSessionSubjectType.ADMIN,
        systemAdministratorId: 1,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        familyId: randomUUID(),
        issuedAt,
        expiresAt: tokens.refreshTokenExpiresAt,
      },
    });
    adminAccessToken = tokens.accessToken;
  }

  return {
    users,
    adminAccessToken,
    privateKey: jwtKeys.privateKey,
    async cleanup() {
      const identities = [...users.values()];
      const accountIds = identities.map((identity) => identity.accountId);
      const workerIds = identities.map((identity) => identity.workerId);
      await prisma.refreshSession.deleteMany({
        where: {
          OR: [
            { accountId: { in: accountIds } },
            ...(includeAdministrator ? [{ systemAdministratorId: 1 }] : []),
          ],
        },
      });
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { accountId: { in: accountIds } },
            ...(includeAdministrator ? [{ systemAdministratorId: 1 }] : []),
          ],
        },
      });
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
      if (includeAdministrator) {
        await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
      }
      await prisma.medicalWorker.deleteMany({ where: { id: { in: workerIds } } });
      jwtKeys.cleanup();
    },
  };
}

export function bearer(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}
