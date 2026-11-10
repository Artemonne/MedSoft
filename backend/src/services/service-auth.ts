import { randomUUID, timingSafeEqual } from 'node:crypto';
import { RefreshSessionSubjectType, ServiceAccountRole, type Prisma } from '@prisma/client';
import { UnauthorizedError } from '../lib/app-error.js';
import { AttemptLimiter } from '../lib/attempt-limiter.js';
import { hashRefreshToken, issueTokenPair, verifyToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { parseServiceApiKey, serviceApiHashMatches } from '../lib/service-api-key.js';
import { lockServiceAccount } from '../lib/service-account-sessions.js';
import type { ServiceAuthContext } from '../types/auth.js';
import { auditService } from './audit.js';

const limiter = new AttemptLimiter('SERVICE_AUTH', 10);
function hashesMatch(first: string, second: string) { const a = Buffer.from(first); const b = Buffer.from(second); return a.length === b.length && timingSafeEqual(a, b); }
async function revokeFamily(transaction: Prisma.TransactionClient, familyId: string, reason: string, at: Date) { await transaction.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at, revocationReason: reason } }); }
function tokenResponse(tokens: Awaited<ReturnType<typeof issueTokenPair>>) { return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenType: 'Bearer' as const, expiresIn: tokens.accessTokenTtlSeconds }; }
async function failed(requestId: string) { await auditService.recordStandalone({ eventType: 'SERVICE_AUTH_FAILED', actor: { type: 'anonymous', requestId }, message: 'Service authentication failed.', metadata: { authenticationKind: 'service' } }); }

export const serviceAuthService = {
  async exchangeApiKey(apiKey: string, requestId: string) {
    limiter.assertAllowed(); const parsed = parseServiceApiKey(apiKey);
    const account = parsed ? await prisma.serviceAccount.findUnique({ where: { keyId: parsed.keyId } }) : null;
    if (!parsed || !account || !account.isActive || !serviceApiHashMatches(account.apiKeyHash, parsed.secret)) {
      limiter.recordFailure(); await failed(requestId); throw new UnauthorizedError('Invalid service credentials.');
    }
    const issuedAt = new Date(); const sessionId = randomUUID(); const familyId = randomUUID();
    const tokens = await issueTokenPair({ subjectId: account.id, subjectType: 'service', serviceRole: account.role, sessionId, issuedAt });
    try {
      await prisma.$transaction(async (transaction) => {
        if (!(await lockServiceAccount(transaction, account.id))) throw new UnauthorizedError('Invalid service credentials.');
        const current = await transaction.serviceAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (!current.isActive || current.keyId !== account.keyId || current.apiKeyHash !== account.apiKeyHash) throw new UnauthorizedError('Invalid service credentials.');
        await transaction.refreshSession.create({ data: { id: sessionId, subjectType: RefreshSessionSubjectType.SERVICE, serviceAccountId: account.id, tokenHash: hashRefreshToken(tokens.refreshToken), familyId, issuedAt, expiresAt: tokens.refreshTokenExpiresAt } });
        await transaction.serviceAccount.update({ where: { id: account.id }, data: { lastUsedAt: issuedAt } });
        await auditService.record(transaction, { eventType: 'SERVICE_AUTH_SUCCEEDED', actor: { type: 'service', serviceAccountId: account.id }, message: 'Service authentication succeeded.', metadata: { role: account.role } });
      });
    } catch (error) { if (error instanceof UnauthorizedError) { limiter.recordFailure(); await failed(requestId); } throw error; }
    limiter.reset(); return tokenResponse(tokens);
  },

  async refresh(refreshToken: string) {
    const claims = await verifyToken(refreshToken, 'refresh', 'service');
    if (claims.serviceRole !== ServiceAccountRole.LIS) throw new UnauthorizedError('Invalid service refresh token.');
    const replacementId = randomUUID(); const issuedAt = new Date();
    const tokens = await issueTokenPair({ subjectId: claims.subjectId, subjectType: 'service', serviceRole: claims.serviceRole, sessionId: replacementId, issuedAt });
    const presentedHash = hashRefreshToken(refreshToken);
    const result = await prisma.$transaction(async (transaction) => {
      if (!(await lockServiceAccount(transaction, claims.subjectId))) return 'invalid' as const;
      const session = await transaction.refreshSession.findUnique({ where: { id: claims.sessionId }, omit: { tokenHash: false }, include: { serviceAccount: true } });
      if (!session || session.subjectType !== RefreshSessionSubjectType.SERVICE || session.serviceAccountId !== claims.subjectId || !hashesMatch(session.tokenHash, presentedHash)) return 'invalid' as const;
      if (session.revokedAt || session.replacedById) { await revokeFamily(transaction, session.familyId, 'reuse-detected', issuedAt); return 'reused' as const; }
      if (session.expiresAt <= issuedAt || !session.serviceAccount?.isActive || session.serviceAccount.role !== claims.serviceRole) { await revokeFamily(transaction, session.familyId, 'subject-unavailable', issuedAt); return 'invalid' as const; }
      const claimed = await transaction.refreshSession.updateMany({ where: { id: session.id, revokedAt: null, replacedById: null, expiresAt: { gt: issuedAt } }, data: { revokedAt: issuedAt, revocationReason: 'rotated' } });
      if (claimed.count !== 1) { await revokeFamily(transaction, session.familyId, 'reuse-detected', issuedAt); return 'reused' as const; }
      await transaction.refreshSession.create({ data: { id: replacementId, subjectType: RefreshSessionSubjectType.SERVICE, serviceAccountId: claims.subjectId, tokenHash: hashRefreshToken(tokens.refreshToken), familyId: session.familyId, issuedAt, expiresAt: tokens.refreshTokenExpiresAt } });
      await transaction.refreshSession.update({ where: { id: session.id }, data: { replacedById: replacementId } });
      return 'rotated' as const;
    });
    if (result !== 'rotated') throw new UnauthorizedError(result === 'reused' ? 'Refresh token reuse detected.' : 'Invalid service refresh token.');
    return tokenResponse(tokens);
  },

  async authenticateAccessToken(token: string): Promise<ServiceAuthContext> {
    const claims = await verifyToken(token, 'access', 'service');
    if (claims.serviceRole !== ServiceAccountRole.LIS) throw new UnauthorizedError('Invalid service token.');
    const session = await prisma.refreshSession.findUnique({ where: { id: claims.sessionId }, include: { serviceAccount: true } });
    if (!session || session.subjectType !== RefreshSessionSubjectType.SERVICE || session.serviceAccountId !== claims.subjectId || session.revokedAt || session.expiresAt <= new Date() || !session.serviceAccount?.isActive || session.serviceAccount.role !== claims.serviceRole) throw new UnauthorizedError('Service session is not active.');
    return { subjectType: 'service', serviceAccountId: claims.subjectId, role: session.serviceAccount.role, sessionId: session.id };
  },

  async logout(context: ServiceAuthContext) {
    await prisma.$transaction(async (transaction) => {
      if (!(await lockServiceAccount(transaction, context.serviceAccountId))) return;
      const session = await transaction.refreshSession.findUnique({ where: { id: context.sessionId } }); if (!session || session.serviceAccountId !== context.serviceAccountId) return;
      await revokeFamily(transaction, session.familyId, 'logout', new Date());
      await auditService.record(transaction, { eventType: 'SERVICE_SESSIONS_REVOKED', actor: { type: 'service', serviceAccountId: context.serviceAccountId }, message: 'Service session logged out.', metadata: { reason: 'logout' } });
    });
  },
};
