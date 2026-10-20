import { randomUUID } from 'node:crypto';
import {
  AuditActorType,
  MedicalWorkerRole,
  RefreshSessionSubjectType,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

describe('security data models', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const usernames = [`usr${suffix}`, `alt${suffix}`];
  let workerId: number;
  let accountId: string;

  beforeAll(async () => {
    const worker = await prisma.medicalWorker.create({
      data: { firstName: 'A', lastName: 'B', position: 'Nurse' },
    });
    workerId = worker.id;
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({
      where: { OR: [{ accountId }, { systemAdministratorId: 1 }] },
    });
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ accountId }, { actorIdentifier: { endsWith: suffix } }] },
    });
    await prisma.account.deleteMany({ where: { username: { in: usernames } } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
    await prisma.medicalWorker.deleteMany({ where: { id: workerId } });
    await prisma.$disconnect();
  });

  it('uses the safe worker-role default for existing API-compatible writes', async () => {
    const worker = await prisma.medicalWorker.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.role).toBe(MedicalWorkerRole.OTHER);
  });

  it('creates an optional one-to-one account and omits its password hash', async () => {
    const account = await prisma.account.create({
      data: {
        username: usernames[0],
        passwordHash: 'test-password-hash',
        medicalWorkerId: workerId,
      },
    });
    accountId = account.id;

    expect(account).toMatchObject({ username: usernames[0], isActive: true });
    expect(account).not.toHaveProperty('passwordHash');

    const detachedAccount = await prisma.account.create({
      data: { username: usernames[1], passwordHash: 'another-test-password-hash' },
    });
    expect(detachedAccount.medicalWorkerId).toBeNull();
  });

  it('enforces unique usernames and one account per medical worker', async () => {
    await expect(
      prisma.account.create({
        data: { username: usernames[0], passwordHash: 'duplicate-username-hash' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.account.update({
        where: { username: usernames[1] },
        data: { medicalWorkerId: workerId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.account.create({
        data: { username: 'ab', passwordHash: 'short-username-hash' },
      }),
    ).rejects.toThrow();
  });

  it('supports administrator setup without exposing credentials by default', async () => {
    const administrator = await prisma.systemAdministrator.create({
      data: { id: 1 },
    });

    expect(administrator.setupState).toBe('PASSWORD_SETUP_REQUIRED');
    expect(administrator).not.toHaveProperty('passwordHash');
    expect(administrator).not.toHaveProperty('totpSecret');

    await expect(
      prisma.systemAdministrator.create({ data: { id: 2 } }),
    ).rejects.toThrow();
  });

  it('records distinct user, administrator, anonymous, and system actors', async () => {
    const common = { message: 'Test audit event' };
    await prisma.auditEvent.createMany({
      data: [
        {
          ...common,
          actorType: AuditActorType.USER,
          actorIdentifier: `user:${suffix}`,
          accountId,
        },
        {
          ...common,
          actorType: AuditActorType.ADMIN,
          actorIdentifier: `admin:${suffix}`,
          systemAdministratorId: 1,
        },
        {
          ...common,
          actorType: AuditActorType.ANONYMOUS,
          actorIdentifier: `anonymous:${suffix}`,
        },
        {
          ...common,
          actorType: AuditActorType.SYSTEM,
          actorIdentifier: `system:${suffix}`,
        },
      ],
    });

    expect(
      await prisma.auditEvent.count({ where: { actorIdentifier: { endsWith: suffix } } }),
    ).toBe(4);
  });

  it('rotates hashed refresh sessions and counts revocations', async () => {
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const first = await prisma.refreshSession.create({
      data: {
        subjectType: RefreshSessionSubjectType.USER,
        accountId,
        tokenHash: `hash-1-${suffix}`,
        familyId,
        expiresAt,
      },
    });
    const replacement = await prisma.refreshSession.create({
      data: {
        subjectType: RefreshSessionSubjectType.USER,
        accountId,
        tokenHash: `hash-2-${suffix}`,
        familyId,
        expiresAt,
      },
    });
    await prisma.refreshSession.update({
      where: { id: first.id },
      data: {
        revokedAt: new Date(),
        revocationReason: 'rotated',
        replacedById: replacement.id,
      },
    });

    const stored = await prisma.refreshSession.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored).not.toHaveProperty('tokenHash');
    expect(stored.replacedById).toBe(replacement.id);
    expect(await prisma.refreshSession.count({ where: { familyId, revokedAt: { not: null } } })).toBe(1);
  });
});
