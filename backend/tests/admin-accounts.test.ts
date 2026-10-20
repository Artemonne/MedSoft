import { randomUUID } from 'node:crypto';
import { AdministratorSetupState, RefreshSessionSubjectType } from '@prisma/client';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { hashRefreshToken, issueTokenPair } from '../src/lib/jwt.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { createTotpSetup } from '../src/lib/totp.js';
import { generateMedicalWorkerPassword } from '../src/services/admin-account.js';
import { installTestJwtKeys } from './helpers/jwt-keys.js';

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const userPassword = 'Medical worker password 370553';

function firstCookie(response: request.Response): string {
  const values = response.headers['set-cookie'];
  if (!Array.isArray(values) || !values[0]) {
    throw new Error('Expected a Set-Cookie response header.');
  }
  return values[0];
}

function cookiePair(response: request.Response): string {
  return firstCookie(response).split(';', 1)[0];
}

describe('administrator medical-worker account management', () => {
  const workerIds: number[] = [];
  let jwtKeys: ReturnType<typeof installTestJwtKeys>;
  let adminAccessToken: string;
  let userAccessToken: string;
  let managedWorkerId: number;
  let secondWorkerId: number;
  let managedAccountId: string;
  let managedPassword: string;

  function adminCall(method: 'get' | 'post' | 'patch', path: string) {
    return request(app)[method](path).set('Authorization', `Bearer ${adminAccessToken}`);
  }

  async function managedLogin() {
    return request(app)
      .post('/api/auth/login')
      .send({ username: `managed${suffix}`, password: managedPassword });
  }

  beforeAll(async () => {
    jwtKeys = installTestJwtKeys();
    await prisma.refreshSession.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.auditEvent.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });

    const adminPasswordHash = await hashPassword('Test administrator password');
    const administrator = await prisma.systemAdministrator.create({
      data: {
        id: 1,
        passwordHash: adminPasswordHash,
        totpSecret: createTotpSetup().secret,
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
        systemAdministratorId: administrator.id,
        tokenHash: hashRefreshToken(tokens.refreshToken),
        familyId: randomUUID(),
        issuedAt,
        expiresAt: tokens.refreshTokenExpiresAt,
      },
    });
    adminAccessToken = tokens.accessToken;

    const workers = await Promise.all([
      prisma.medicalWorker.create({
        data: { firstName: 'Managed', lastName: 'Worker', position: 'Doctor' },
      }),
      prisma.medicalWorker.create({
        data: { firstName: 'Second', lastName: 'Worker', position: 'Nurse' },
      }),
      prisma.medicalWorker.create({
        data: { firstName: 'Ordinary', lastName: 'User', position: 'Nurse' },
      }),
    ]);
    workerIds.push(...workers.map((worker) => worker.id));
    [managedWorkerId, secondWorkerId] = workers.map((worker) => worker.id);

    await prisma.account.create({
      data: {
        username: `ordinary${suffix}`,
        passwordHash: await hashPassword(userPassword),
        medicalWorkerId: workers[2].id,
      },
    });
    const userLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: `ordinary${suffix}`, password: userPassword });
    userAccessToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({
      where: { medicalWorkerId: { in: workerIds } },
      select: { id: true },
    });
    await prisma.refreshSession.deleteMany({
      where: {
        OR: [
          { accountId: { in: accounts.map((account) => account.id) } },
          { systemAdministratorId: 1 },
        ],
      },
    });
    await prisma.account.deleteMany({ where: { id: { in: accounts.map((account) => account.id) } } });
    await prisma.auditEvent.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
    await prisma.medicalWorker.deleteMany({ where: { id: { in: workerIds } } });
    await prisma.$disconnect();
    jwtKeys.cleanup();
  });

  it('generates exactly twelve characters from the permitted alphabet', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(generateMedicalWorkerPassword()).toMatch(/^[A-Za-z0-9]{12}$/);
    }
  });

  it('rejects missing and ordinary-user authorization', async () => {
    const missing = await request(app).get('/api/admin/accounts');
    const ordinaryUser = await request(app)
      .get('/api/admin/accounts')
      .set('Authorization', `Bearer ${userAccessToken}`);

    expect(missing.status).toBe(401);
    expect(ordinaryUser.status).toBe(401);
  });

  it('does not allow standalone or nonexistent-worker accounts', async () => {
    const standalone = await adminCall('post', '/api/admin/accounts').send({
      username: `alone${suffix}`,
    });
    const missingWorker = await adminCall('post', '/api/admin/accounts').send({
      username: `missing${suffix}`,
      medicalWorkerId: 2_147_483_647,
    });

    expect(standalone.status).toBe(400);
    expect(missingWorker.status).toBe(404);
  });

  it('creates a linked account and reveals its generated password only once', async () => {
    const response = await adminCall('post', '/api/admin/accounts').send({
      username: `managed${suffix}`,
      medicalWorkerId: managedWorkerId,
    });

    expect(response.status).toBe(201);
    expect(response.body.generatedPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(response.body.account).toMatchObject({
      username: `managed${suffix}`,
      isActive: true,
      medicalWorker: { id: managedWorkerId, role: 'other' },
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    managedAccountId = response.body.account.id;
    managedPassword = response.body.generatedPassword;

    const stored = await prisma.account.findUniqueOrThrow({
      where: { id: managedAccountId },
      omit: { passwordHash: false },
    });
    expect(stored.passwordHash).not.toBe(managedPassword);
    expect(await verifyPassword(managedPassword, stored.passwordHash)).toBe(true);
  });

  it('enforces unique usernames and one account per medical worker', async () => {
    const duplicateUsername = await adminCall('post', '/api/admin/accounts').send({
      username: `managed${suffix}`,
      medicalWorkerId: secondWorkerId,
    });
    const duplicateWorker = await adminCall('post', '/api/admin/accounts').send({
      username: `diff${suffix}`,
      medicalWorkerId: managedWorkerId,
    });

    expect(duplicateUsername.status).toBe(409);
    expect(duplicateWorker.status).toBe(409);
    expect(await prisma.account.count({ where: { medicalWorkerId: managedWorkerId } })).toBe(1);
  });

  it('lists safe account fields without credentials or generated passwords', async () => {
    const response = await adminCall('get', '/api/admin/accounts');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: managedAccountId,
          username: `managed${suffix}`,
          medicalWorker: expect.objectContaining({ id: managedWorkerId }),
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(managedPassword);
  });

  it('changes the password and revokes only active, unexpired refresh sessions', async () => {
    const login = await managedLogin();
    expect(login.status).toBe(200);
    const activeSessionId = decodeJwt(
      decodeURIComponent(cookiePair(login).split('=', 2)[1]),
    ).sessionId as string;
    const oldIssuedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const expiredSession = await prisma.refreshSession.create({
      data: {
        subjectType: RefreshSessionSubjectType.USER,
        accountId: managedAccountId,
        tokenHash: `expired-${suffix}`,
        familyId: randomUUID(),
        issuedAt: oldIssuedAt,
        expiresAt: new Date(oldIssuedAt.getTime() + 60_000),
      },
    });

    const response = await adminCall(
      'post',
      `/api/admin/accounts/${managedAccountId}/password`,
    );
    expect(response.status).toBe(200);
    expect(response.body.generatedPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(response.body.revokedRefreshTokens).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    managedPassword = response.body.generatedPassword;

    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id: activeSessionId } })).revokedAt,
    ).not.toBeNull();
    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id: expiredSession.id } })).revokedAt,
    ).toBeNull();
  });

  it('changes the linked worker role and revokes current sessions atomically', async () => {
    const login = await managedLogin();
    expect(login.status).toBe(200);

    const response = await adminCall(
      'patch',
      `/api/admin/accounts/${managedAccountId}/role`,
    ).send({ role: 'laboratory-technician' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      revokedRefreshTokens: 1,
      account: { medicalWorker: { role: 'laboratory-technician' } },
    });

    const oldAccess = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(oldAccess.status).toBe(401);
  });

  it('atomically deactivates during refresh and never leaves an active session', async () => {
    const login = await managedLogin();
    expect(login.status).toBe(200);

    const [deactivation, refresh] = await Promise.all([
      adminCall('patch', `/api/admin/accounts/${managedAccountId}/status`).send({
        isActive: false,
      }),
      request(app)
        .post('/api/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', cookiePair(login)),
    ]);

    expect(deactivation.status).toBe(200);
    expect(deactivation.body.account.isActive).toBe(false);
    expect(deactivation.body.revokedRefreshTokens).toBe(1);
    expect([200, 401]).toContain(refresh.status);
    expect(
      await prisma.refreshSession.count({
        where: {
          accountId: managedAccountId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ).toBe(0);

    const rejectedLogin = await managedLogin();
    expect(rejectedLogin.status).toBe(401);
  });

  it('reactivates without restoring old sessions', async () => {
    const revokedBefore = await prisma.refreshSession.count({
      where: { accountId: managedAccountId, revokedAt: { not: null } },
    });
    const response = await adminCall(
      'patch',
      `/api/admin/accounts/${managedAccountId}/status`,
    ).send({ isActive: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      revokedRefreshTokens: 0,
      account: { isActive: true },
    });
    expect(
      await prisma.refreshSession.count({
        where: { accountId: managedAccountId, revokedAt: { not: null } },
      }),
    ).toBe(revokedBefore);
    expect((await managedLogin()).status).toBe(200);
  });

  it('deactivates the account and revokes sessions when its worker is soft-deleted', async () => {
    const login = await managedLogin();
    expect(login.status).toBe(200);
    const sessionId = decodeJwt(
      decodeURIComponent(cookiePair(login).split('=', 2)[1]),
    ).sessionId as string;

    const response = await request(app)
      .delete(`/api/medical-workers/${managedWorkerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(response.status).toBe(204);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: managedAccountId } })).isActive,
    ).toBe(false);
    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
    ).not.toBeNull();
    expect((await managedLogin()).status).toBe(401);
  });
});
