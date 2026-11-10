import { MedicalWorkerRole, RefreshSessionSubjectType } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { auditService } from '../src/services/audit.js';
import { serviceAccountService } from '../src/services/service-account.js';
import { bearer, createAuthorizationFixture, type TestUserIdentity } from './helpers/auth-fixture.js';

describe('service account administration and token lifecycle', () => {
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>; let user: TestUserIdentity;
  beforeAll(async () => { fixture = await createAuthorizationFixture([MedicalWorkerRole.DOCTOR], true); user = fixture.users.get(MedicalWorkerRole.DOCTOR)!; });
  beforeEach(async () => { await prisma.refreshSession.deleteMany({ where: { serviceAccountId: { not: null } } }); await prisma.auditEvent.deleteMany({ where: { serviceAccountId: { not: null } } }); await prisma.auditEvent.deleteMany({ where: { eventType: 'SERVICE_AUTH_FAILED' } }); await prisma.serviceAccount.deleteMany(); });
  afterAll(async () => { await prisma.refreshSession.deleteMany({ where: { serviceAccountId: { not: null } } }); await prisma.auditEvent.deleteMany({ where: { serviceAccountId: { not: null } } }); await prisma.serviceAccount.deleteMany(); await fixture.cleanup(); await prisma.$disconnect(); });
  const admin = () => bearer(fixture.adminAccessToken!);
  const create = (name = 'Test LIS') => request(app).post('/api/admin/service-accounts').set(admin()).send({ name }).expect(201);
  const exchange = (apiKey: string, status = 200) => request(app).post('/api/service-auth/token').send({ apiKey }).expect(status);

  it('creates an isolated account and returns its API key only once', async () => {
    expect((await request(app).post('/api/admin/service-accounts').set(bearer(user.accessToken)).send({ name: 'Forbidden LIS' })).status).toBe(401);
    const created = await create(); expect(created.body.apiKey).toMatch(/^msk_/); expect(created.body.account.role).toBe('LIS');
    const list = await request(app).get('/api/admin/service-accounts').set(admin()).expect(200); expect(JSON.stringify(list.body)).not.toContain(created.body.apiKey); expect(list.body[0]).not.toHaveProperty('apiKeyHash');
    const detail = await request(app).get(`/api/admin/service-accounts/${created.body.account.id}`).set(admin()).expect(200); expect(detail.body).not.toHaveProperty('apiKey');
  });
  it('exchanges a valid key, rejects an invalid key and tests connection', async () => {
    const created = await create(); const tokens = await exchange(created.body.apiKey); expect(tokens.body).toMatchObject({ tokenType: 'Bearer' });
    await exchange(created.body.apiKey.slice(0, -1) + 'x', 401); await request(app).get('/api/service-auth/test-connection').set(bearer(tokens.body.accessToken)).expect(200).expect({ status: 'connected', role: 'LIS' });
  });
  it('rotates refresh tokens and revokes a replayed family', async () => {
    const created = await create(); const initial = (await exchange(created.body.apiKey)).body; const rotated = await request(app).post('/api/service-auth/refresh').send({ refreshToken: initial.refreshToken }).expect(200); expect(rotated.body.refreshToken).not.toBe(initial.refreshToken);
    await request(app).post('/api/service-auth/refresh').send({ refreshToken: initial.refreshToken }).expect(401); await request(app).post('/api/service-auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401); expect(await prisma.refreshSession.count({ where: { serviceAccountId: created.body.account.id, revokedAt: null } })).toBe(0);
  });
  it('serializes concurrent refresh and leaves the family revoked', async () => {
    const created = await create(); const initial = (await exchange(created.body.apiKey)).body; const responses = await Promise.all([request(app).post('/api/service-auth/refresh').send({ refreshToken: initial.refreshToken }), request(app).post('/api/service-auth/refresh').send({ refreshToken: initial.refreshToken })]); expect(responses.map((item) => item.status).sort()).toEqual([200, 401]); expect(await prisma.refreshSession.count({ where: { serviceAccountId: created.body.account.id, revokedAt: null } })).toBe(0);
  });
  it('logs out and immediately invalidates the access token', async () => {
    const created = await create(); const tokens = (await exchange(created.body.apiKey)).body; await request(app).post('/api/service-auth/logout').set(bearer(tokens.accessToken)).expect(204); await request(app).get('/api/service-auth/test-connection').set(bearer(tokens.accessToken)).expect(401);
  });
  it('rotates API keys and invalidates old credentials and sessions', async () => {
    const created = await create(); const oldTokens = (await exchange(created.body.apiKey)).body; const rotated = await request(app).post(`/api/admin/service-accounts/${created.body.account.id}/rotate-key`).set(admin()).expect(200); expect(rotated.body.apiKey).not.toBe(created.body.apiKey); expect(rotated.body.revokedRefreshTokens).toBeGreaterThan(0); await exchange(created.body.apiKey, 401); await request(app).get('/api/service-auth/test-connection').set(bearer(oldTokens.accessToken)).expect(401); await exchange(rotated.body.apiKey);
  });
  it('deactivates and requires key rotation after reactivation', async () => {
    const created = await create(); const tokens = (await exchange(created.body.apiKey)).body; await request(app).patch(`/api/admin/service-accounts/${created.body.account.id}/status`).set(admin()).send({ isActive: false }).expect(200); await exchange(created.body.apiKey, 401); await request(app).get('/api/service-auth/test-connection').set(bearer(tokens.accessToken)).expect(401); const active = await request(app).patch(`/api/admin/service-accounts/${created.body.account.id}/status`).set(admin()).send({ isActive: true }).expect(200); expect(active.body.requiresKeyRotation).toBe(true); await exchange(created.body.apiKey, 401); const rotated = await request(app).post(`/api/admin/service-accounts/${created.body.account.id}/rotate-key`).set(admin()).expect(200); await exchange(rotated.body.apiKey);
  });
  it('isolates service, user and administrator tokens', async () => {
    const created = await create(); const service = (await exchange(created.body.apiKey)).body; await request(app).get('/api/patients').set(bearer(service.accessToken)).expect(401); await request(app).get('/api/admin/accounts').set(bearer(service.accessToken)).expect(401); await request(app).get('/api/service-auth/test-connection').set(bearer(user.accessToken)).expect(401); await request(app).get('/api/service-auth/test-connection').set(admin()).expect(401);
  });
  it('enforces exactly one typed refresh-session owner in PostgreSQL', async () => {
    const created = await create(); await exchange(created.body.apiKey); const session = await prisma.refreshSession.findFirstOrThrow({ where: { serviceAccountId: created.body.account.id } }); expect(session.subjectType).toBe(RefreshSessionSubjectType.SERVICE); expect(session.accountId).toBeNull(); expect(session.systemAdministratorId).toBeNull(); await expect(prisma.refreshSession.create({ data: { subjectType: 'SERVICE', serviceAccountId: created.body.account.id, accountId: user.accountId, tokenHash: `invalid-${Date.now()}`, familyId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 10000) } })).rejects.toThrow();
  });
  it('audits without secrets and rolls back when audit persistence fails', async () => {
    const created = await create('Audited LIS'); await exchange(created.body.apiKey); const events = await prisma.auditEvent.findMany({ where: { OR: [{ serviceAccountId: created.body.account.id }, { eventType: 'SERVICE_ACCOUNT_CREATED' }] } }); const serialized = JSON.stringify(events); expect(serialized).not.toContain(created.body.apiKey); expect(serialized).not.toContain('apiKeyHash'); expect(events.some((event) => event.eventType === 'SERVICE_ACCOUNT_CREATED' && event.actorType === 'ADMIN')).toBe(true); expect(events.some((event) => event.eventType === 'SERVICE_AUTH_SUCCEEDED' && event.actorType === 'SERVICE')).toBe(true);
    const spy = vi.spyOn(auditService, 'record').mockRejectedValueOnce(new Error('audit unavailable')); await expect(serviceAccountService.create({ name: 'Rollback LIS' }, 1)).rejects.toThrow('audit unavailable'); spy.mockRestore(); expect(await prisma.serviceAccount.findUnique({ where: { name: 'Rollback LIS' } })).toBeNull();
  });
});
