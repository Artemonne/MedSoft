import { ServiceAccountRole } from '@prisma/client';
import { NotFoundError } from '../lib/app-error.js';
import { generateServiceApiKey, maskedServiceKeyId } from '../lib/service-api-key.js';
import { lockServiceAccount, revokeServiceSessions } from '../lib/service-account-sessions.js';
import { prisma } from '../lib/prisma.js';
import type { CreateServiceAccountInput } from '../schemas/service-account.js';
import { auditService } from './audit.js';

const publicSelect = { id: true, name: true, role: true, isActive: true, keyId: true, keyVersion: true, rotatedAt: true, lastUsedAt: true, createdAt: true, updatedAt: true } as const;
function publicAccount<T extends { keyId: string }>(account: T) { const { keyId, ...rest } = account; return { ...rest, keyIdentifier: maskedServiceKeyId(keyId) }; }

export const serviceAccountService = {
  async list() { return (await prisma.serviceAccount.findMany({ select: publicSelect, orderBy: { createdAt: 'asc' } })).map(publicAccount); },
  async getById(id: string) { const item = await prisma.serviceAccount.findUnique({ where: { id }, select: publicSelect }); if (!item) throw new NotFoundError('Service account'); return publicAccount(item); },
  async create(input: CreateServiceAccountInput, administratorId: 1) {
    const key = generateServiceApiKey();
    const account = await prisma.$transaction(async (transaction) => {
      const created = await transaction.serviceAccount.create({ data: { name: input.name, role: ServiceAccountRole.LIS, keyId: key.keyId, apiKeyHash: key.apiKeyHash }, select: publicSelect });
      await auditService.record(transaction, { eventType: 'SERVICE_ACCOUNT_CREATED', actor: { type: 'admin', administratorId }, message: `Service account ${created.id} created.`, metadata: { serviceAccountId: created.id, role: created.role } });
      return created;
    });
    return { account: publicAccount(account), apiKey: key.apiKey };
  },
  async setActive(id: string, isActive: boolean, administratorId: 1) {
    const hiddenKey = !isActive ? generateServiceApiKey() : null; const at = new Date();
    return prisma.$transaction(async (transaction) => {
      if (!(await lockServiceAccount(transaction, id))) throw new NotFoundError('Service account');
      const current = await transaction.serviceAccount.findUniqueOrThrow({ where: { id } });
      const revoked = await revokeServiceSessions(transaction, id, isActive ? 'reactivated' : 'deactivated', at);
      const account = await transaction.serviceAccount.update({ where: { id }, data: { isActive, ...(hiddenKey ? { keyId: hiddenKey.keyId, apiKeyHash: hiddenKey.apiKeyHash, keyVersion: { increment: 1 }, rotatedAt: at } : {}) }, select: publicSelect });
      await auditService.record(transaction, { eventType: 'SERVICE_ACCOUNT_ACTIVATION_CHANGED', actor: { type: 'admin', administratorId }, message: `Service account ${id} ${isActive ? 'activated' : 'deactivated'}.`, metadata: { serviceAccountId: id, isActive, revokedRefreshTokens: revoked } });
      return { account: publicAccount(account), revokedRefreshTokens: revoked, requiresKeyRotation: isActive && !current.isActive };
    });
  },
  async rotateKey(id: string, administratorId: 1) {
    const key = generateServiceApiKey(); const at = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      if (!(await lockServiceAccount(transaction, id))) throw new NotFoundError('Service account');
      const revoked = await revokeServiceSessions(transaction, id, 'api-key-rotated', at);
      const account = await transaction.serviceAccount.update({ where: { id }, data: { keyId: key.keyId, apiKeyHash: key.apiKeyHash, keyVersion: { increment: 1 }, rotatedAt: at }, select: publicSelect });
      await auditService.record(transaction, { eventType: 'SERVICE_ACCOUNT_KEY_ROTATED', actor: { type: 'admin', administratorId }, message: `API key for service account ${id} rotated.`, metadata: { serviceAccountId: id, keyVersion: account.keyVersion, revokedRefreshTokens: revoked } });
      return { account: publicAccount(account), revokedRefreshTokens: revoked };
    });
    return { ...result, apiKey: key.apiKey };
  },
};
