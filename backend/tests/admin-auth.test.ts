import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { TOTP_ISSUER, TOTP_LABEL } from '../src/lib/totp.js';
import { installTestJwtKeys } from './helpers/jwt-keys.js';

const bootstrapSecret = 'test-bootstrap-secret-370553';
const password = 'Administrator password 370553';
const bootstrapHeader = { 'X-Admin-Bootstrap-Secret': bootstrapSecret };

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

describe('system administrator bootstrap and TOTP authentication', () => {
  let jwtKeys: ReturnType<typeof installTestJwtKeys>;
  let manualSecret: string;

  function totp(timestamp = Date.now()): string {
    return new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: TOTP_LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(manualSecret),
    }).generate({ timestamp });
  }

  function invalidCurrentTotp(): string {
    const now = Date.now();
    const accepted = new Set([totp(now - 30_000), totp(now), totp(now + 30_000)]);
    for (let candidate = 0; candidate <= 999_999; candidate += 1) {
      const code = candidate.toString().padStart(6, '0');
      if (!accepted.has(code)) {
        return code;
      }
    }
    throw new Error('Could not produce an invalid TOTP code.');
  }

  function staleTotp(): string {
    const now = Date.now();
    const accepted = new Set([totp(now - 30_000), totp(now), totp(now + 30_000)]);
    for (let offset = 90_000; offset <= 300_000; offset += 30_000) {
      const code = totp(now - offset);
      if (!accepted.has(code)) {
        return code;
      }
    }
    throw new Error('Could not produce a non-colliding stale TOTP code.');
  }

  async function login(loginPassword = password, totpCode = totp()) {
    return request(app)
      .post('/api/admin/auth/login')
      .send({ password: loginPassword, totpCode });
  }

  beforeAll(async () => {
    jwtKeys = installTestJwtKeys();
    process.env.ADMIN_BOOTSTRAP_SECRET_HASH = createHash('sha256')
      .update(bootstrapSecret, 'utf8')
      .digest('hex');
    await prisma.refreshSession.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.auditEvent.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.auditEvent.deleteMany({ where: { systemAdministratorId: 1 } });
    await prisma.systemAdministrator.deleteMany({ where: { id: 1 } });
    delete process.env.ADMIN_BOOTSTRAP_SECRET_HASH;
    await prisma.$disconnect();
    jwtKeys.cleanup();
  });

  it('reports an unconfigured administrator and validates password confirmation', async () => {
    const status = await request(app).get('/api/admin/bootstrap/status');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ status: 'NOT_CONFIGURED' });

    const mismatch = await request(app)
      .post('/api/admin/bootstrap/start')
      .set(bootstrapHeader)
      .send({ password, passwordConfirmation: `${password}!` });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.systemAdministrator.count()).toBe(0);
  });

  it('requires the out-of-band bootstrap secret', async () => {
    const response = await request(app)
      .post('/api/admin/bootstrap/start')
      .set('X-Admin-Bootstrap-Secret', 'incorrect-secret')
      .send({ password, passwordConfirmation: password });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid bootstrap credentials.',
    });
    expect(await prisma.systemAdministrator.count()).toBe(0);
  });

  it('allows only one concurrent bootstrap owner and returns QR/manual setup data once', async () => {
    const calls = await Promise.all([
      request(app)
        .post('/api/admin/bootstrap/start')
        .set(bootstrapHeader)
        .send({ password, passwordConfirmation: password }),
      request(app)
        .post('/api/admin/bootstrap/start')
        .set(bootstrapHeader)
        .send({ password, passwordConfirmation: password }),
    ]);

    expect(calls.map((response) => response.status).sort()).toEqual([201, 409]);
    const successful = calls.find((response) => response.status === 201)!;
    manualSecret = successful.body.manualSecret;
    expect(manualSecret).toMatch(/^[A-Z2-7]{32}$/);
    expect(successful.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(successful.body.otpauthUrl).toContain('issuer=MedSoft');
    expect(successful.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(await prisma.systemAdministrator.count()).toBe(1);

    const stored = await prisma.systemAdministrator.findUniqueOrThrow({ where: { id: 1 } });
    expect(stored.setupState).toBe('TOTP_SETUP_REQUIRED');
    expect(stored).not.toHaveProperty('passwordHash');
    expect(stored).not.toHaveProperty('totpSecret');
  });

  it('does not complete setup with an invalid TOTP code', async () => {
    const response = await request(app)
      .post('/api/admin/bootstrap/complete')
      .set(bootstrapHeader)
      .send({ totpCode: invalidCurrentTotp() });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid bootstrap credentials.');
    expect(
      (await prisma.systemAdministrator.findUniqueOrThrow({ where: { id: 1 } })).setupState,
    ).toBe('TOTP_SETUP_REQUIRED');
  });

  it('atomically completes setup once and permanently disables bootstrap', async () => {
    const code = totp();
    const calls = await Promise.all([
      request(app)
        .post('/api/admin/bootstrap/complete')
        .set(bootstrapHeader)
        .send({ totpCode: code }),
      request(app)
        .post('/api/admin/bootstrap/complete')
        .set(bootstrapHeader)
        .send({ totpCode: code }),
    ]);

    expect(calls.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(JSON.stringify(calls.find((response) => response.status === 200)!.body)).not.toContain(
      manualSecret,
    );
    expect((await request(app).get('/api/admin/bootstrap/status')).body).toEqual({
      status: 'CONFIGURED',
    });

    const repeated = await request(app)
      .post('/api/admin/bootstrap/start')
      .set(bootstrapHeader)
      .send({ password, passwordConfirmation: password });
    expect(repeated.status).toBe(409);
    expect(await prisma.systemAdministrator.count()).toBe(1);
  });

  it('requires password and a fresh TOTP code with uniform authentication errors', async () => {
    const missingTotp = await request(app)
      .post('/api/admin/auth/login')
      .send({ password });
    expect(missingTotp.status).toBe(400);

    const responses = await Promise.all([
      login('incorrect password', totp()),
      login(password, invalidCurrentTotp()),
      login(password, staleTotp()),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Invalid administrator credentials.',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('logs in, keeps secrets out of responses, and distinguishes the admin subject', async () => {
    const response = await login();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      accessTokenExpiresIn: 900,
      administrator: { id: 1, subjectType: 'admin', setupState: 'ACTIVE' },
    });
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(JSON.stringify(response.body)).not.toContain(manualSecret);
    expect(JSON.stringify(response.body)).not.toContain('totpSecret');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(firstCookie(response)).toContain('medsoft_admin_refresh=');
    expect(firstCookie(response)).toContain('HttpOnly');
    expect(firstCookie(response)).toContain('Secure');
    expect(firstCookie(response)).toContain('SameSite=Strict');
    expect(firstCookie(response)).toContain('Path=/api/admin/auth');

    const claims = decodeJwt(response.body.accessToken);
    expect(claims).toMatchObject({ subjectType: 'admin', tokenType: 'access' });
    const userEndpoint = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`);
    expect(userEndpoint.status).toBe(401);

    const me = await request(app)
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toContain(manualSecret);
  });

  it('rotates the administrative refresh token and rejects the old access token', async () => {
    const loginResponse = await login();
    const oldCookie = cookiePair(loginResponse);
    const oldRefreshToken = cookieToken(loginResponse);

    const refreshAsAccess = await request(app)
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${oldRefreshToken}`);
    const accessAsRefresh = await request(app)
      .post('/api/admin/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', `medsoft_admin_refresh=${loginResponse.body.accessToken}`);
    expect(refreshAsAccess.status).toBe(401);
    expect(accessAsRefresh.status).toBe(401);

    const rotation = await request(app)
      .post('/api/admin/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', oldCookie);
    expect(rotation.status).toBe(200);
    expect(cookieToken(rotation)).not.toBe(oldRefreshToken);

    const oldAccess = await request(app)
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);
    const newAccess = await request(app)
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${rotation.body.accessToken}`);
    expect(oldAccess.status).toBe(401);
    expect(newAccess.status).toBe(200);
  });

  it('revokes the administrative session on logout', async () => {
    const loginResponse = await login();
    const sessionId = decodeJwt(cookieToken(loginResponse)).sessionId as string;
    const logout = await request(app)
      .post('/api/admin/auth/logout')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', cookiePair(loginResponse));

    expect(logout.status).toBe(204);
    expect(firstCookie(logout)).toContain('medsoft_admin_refresh=');
    expect(firstCookie(logout)).toContain('Expires=Thu, 01 Jan 1970');
    expect(
      (await prisma.refreshSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
    ).not.toBeNull();

    const me = await request(app)
      .get('/api/admin/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('rate-limits repeated administrator login failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login('always incorrect', totp());
      expect(response.status).toBe(401);
    }
    const blocked = await login('always incorrect', totp());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
