import { randomUUID } from 'node:crypto';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';
import { installTestJwtKeys } from './helpers/jwt-keys.js';

const password = 'Correct horse battery staple 370553';
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const usernames = {
  active: `a${suffix}`,
  inactive: `i${suffix}`,
  deleted: `d${suffix}`,
  detached: `n${suffix}`,
};

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

function cookieToken(response: request.Response): string {
  return decodeURIComponent(cookiePair(response).split('=', 2)[1]);
}

function tamperSegment(token: string, segmentIndex: number): string {
  const segments = token.split('.');
  const segment = segments[segmentIndex];
  segments[segmentIndex] = `${segment[0] === 'A' ? 'B' : 'A'}${segment.slice(1)}`;
  return segments.join('.');
}

describe('account authentication and JWT sessions', () => {
  const workerIds: number[] = [];
  const accountIds: string[] = [];
  let activeAccountId: string;
  let jwtKeys: ReturnType<typeof installTestJwtKeys>;

  beforeAll(async () => {
    jwtKeys = installTestJwtKeys();
    const passwordHash = await hashPassword(password);
    const [activeWorker, deletedWorker] = await Promise.all([
      prisma.medicalWorker.create({
        data: { firstName: 'Active', lastName: 'Worker', position: 'Doctor', role: 'DOCTOR' },
      }),
      prisma.medicalWorker.create({
        data: {
          firstName: 'Deleted',
          lastName: 'Worker',
          position: 'Nurse',
          role: 'NURSE',
          isDeleted: true,
        },
      }),
    ]);
    workerIds.push(activeWorker.id, deletedWorker.id);

    const [active, inactive, deleted, detached] = await Promise.all([
      prisma.account.create({
        data: { username: usernames.active, passwordHash, medicalWorkerId: activeWorker.id },
      }),
      prisma.account.create({
        data: { username: usernames.inactive, passwordHash, isActive: false },
      }),
      prisma.account.create({
        data: { username: usernames.deleted, passwordHash, medicalWorkerId: deletedWorker.id },
      }),
      prisma.account.create({
        data: { username: usernames.detached, passwordHash },
      }),
    ]);
    activeAccountId = active.id;
    accountIds.push(active.id, inactive.id, deleted.id, detached.id);
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.medicalWorker.deleteMany({ where: { id: { in: workerIds } } });
    await prisma.$disconnect();
    jwtKeys.cleanup();
  });

  async function login() {
    return request(app)
      .post('/api/auth/login')
      .send({ username: usernames.active, password });
  }

  it('logs in with a valid password and keeps secrets out of the JSON response', async () => {
    const response = await login();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      accessTokenExpiresIn: 900,
      account: {
        id: activeAccountId,
        username: usernames.active,
        medicalWorker: { role: 'doctor' },
      },
    });
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(firstCookie(response)).toContain('HttpOnly');
    expect(firstCookie(response)).toContain('Secure');
    expect(firstCookie(response)).toContain('SameSite=Strict');
    expect(firstCookie(response)).toContain('Path=/api/auth');

    const sessionId = decodeJwt(cookieToken(response)).sessionId as string;
    const stored = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: sessionId },
      omit: { tokenHash: false },
    });
    expect(stored.tokenHash).not.toBe(cookieToken(response));
  });

  it('rejects a wrong password and unavailable accounts uniformly', async () => {
    const attempts = [
      { username: usernames.active, password: 'wrong password' },
      { username: `x${suffix}`, password },
      { username: usernames.inactive, password },
      { username: usernames.deleted, password },
      { username: usernames.detached, password },
    ];

    for (const credentials of attempts) {
      const response = await request(app).post('/api/auth/login').send(credentials);
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('returns the current linked medical-worker account for a valid access token', async () => {
    const loginResponse = await login();
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: activeAccountId,
      username: usernames.active,
      isActive: true,
      medicalWorker: { firstName: 'Active', role: 'doctor' },
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('rejects missing, wrongly signed, tampered, expired, and wrong-issuer access tokens', async () => {
    const loginResponse = await login();
    const accessToken = loginResponse.body.accessToken as string;
    const payload = decodeJwt(accessToken);
    const signingKey = await importPKCS8(
      jwtKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'EdDSA',
    );
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({
      tokenType: 'access',
      sessionId: payload.sessionId,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer('medsoft-api')
      .setAudience('medsoft-client')
      .setSubject(activeAccountId)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(signingKey);
    const wrongIssuerToken = await new SignJWT({
      tokenType: 'access',
      sessionId: payload.sessionId,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer('another-issuer')
      .setAudience('medsoft-client')
      .setSubject(activeAccountId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(signingKey);
    const wrongAudienceToken = await new SignJWT({
      tokenType: 'access',
      sessionId: payload.sessionId,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer('medsoft-api')
      .setAudience('another-audience')
      .setSubject(activeAccountId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(signingKey);
    const wrongAlgorithmToken = await new SignJWT({
      tokenType: 'access',
      sessionId: payload.sessionId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('medsoft-api')
      .setAudience('medsoft-client')
      .setSubject(activeAccountId)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode('not-an-asymmetric-signing-key'));

    const tokens = [
      undefined,
      tamperSegment(accessToken, 2),
      tamperSegment(accessToken, 1),
      expiredToken,
      wrongIssuerToken,
      wrongAudienceToken,
      wrongAlgorithmToken,
    ];
    for (const token of tokens) {
      const call = request(app).get('/api/auth/me');
      if (token) call.set('Authorization', `Bearer ${token}`);
      const response = await call;
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('does not allow access and refresh tokens to exchange roles', async () => {
    const loginResponse = await login();
    const refreshAsAccess = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${cookieToken(loginResponse)}`);
    expect(refreshAsAccess.status).toBe(401);

    const accessAsRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', `medsoft_refresh=${loginResponse.body.accessToken}`);
    expect(accessAsRefresh.status).toBe(401);
  });

  it('requires the CSRF header for cookie-authenticated mutations', async () => {
    const loginResponse = await login();
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookiePair(loginResponse));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rotates both tokens and rejects reuse of the previous refresh token', async () => {
    const loginResponse = await login();
    const oldCookie = cookiePair(loginResponse);
    const oldRefreshToken = cookieToken(loginResponse);
    const oldSessionId = decodeJwt(oldRefreshToken).sessionId as string;

    const rotation = await request(app)
      .post('/api/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', oldCookie);
    expect(rotation.status).toBe(200);
    expect(rotation.body.accessToken).not.toBe(loginResponse.body.accessToken);
    expect(cookieToken(rotation)).not.toBe(oldRefreshToken);

    const oldAccess = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);
    const replacementAccess = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${rotation.body.accessToken}`);
    expect(oldAccess.status).toBe(401);
    expect(replacementAccess.status).toBe(200);

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', oldCookie);
    expect(replay.status).toBe(401);

    const oldSession = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: oldSessionId },
    });
    expect(oldSession.revokedAt).not.toBeNull();
    expect(oldSession.replacedById).not.toBeNull();
    expect(
      await prisma.refreshSession.count({
        where: { familyId: oldSession.familyId, revokedAt: null },
      }),
    ).toBe(0);

    const successorAfterReplay = await request(app)
      .post('/api/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', cookiePair(rotation));
    expect(successorAfterReplay.status).toBe(401);
  });

  it('allows at most one concurrent rotation and never leaves multiple active heirs', async () => {
    const loginResponse = await login();
    const originalSessionId = decodeJwt(cookieToken(loginResponse)).sessionId as string;
    const calls = await Promise.all([
      request(app)
        .post('/api/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', cookiePair(loginResponse)),
      request(app)
        .post('/api/auth/refresh')
        .set('X-CSRF-Protection', '1')
        .set('Cookie', cookiePair(loginResponse)),
    ]);

    expect(calls.map((response) => response.status).sort()).toEqual([200, 401]);
    const originalSession = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: originalSessionId },
    });
    expect(
      await prisma.refreshSession.count({
        where: { familyId: originalSession.familyId, revokedAt: null },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it('revokes the session on logout and clears the refresh cookie', async () => {
    const loginResponse = await login();
    const sessionId = decodeJwt(cookieToken(loginResponse)).sessionId as string;
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', cookiePair(loginResponse));

    expect(logout.status).toBe(204);
    expect(firstCookie(logout)).toContain('medsoft_refresh=');
    expect(firstCookie(logout)).toContain('Expires=Thu, 01 Jan 1970');
    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
    ).not.toBeNull();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);
    expect(me.status).toBe(401);
  });
});
