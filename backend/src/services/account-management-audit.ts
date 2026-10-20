import type { Prisma } from '@prisma/client';
import { auditService, type AuditEventType } from './audit.js';

export type AccountManagementAction =
  | 'account-created'
  | 'password-changed'
  | 'activation-changed'
  | 'role-changed'
  | 'worker-deleted';

export interface AccountManagementChange {
  action: AccountManagementAction;
  actor: { type: 'admin'; administratorId: 1 } | { type: 'system' };
  accountId: string;
  medicalWorkerId: number;
  revokedRefreshTokens: number;
  occurredAt: Date;
}

const eventTypes: Record<AccountManagementAction, AuditEventType> = {
  'account-created': 'ACCOUNT_CREATED',
  'password-changed': 'ACCOUNT_PASSWORD_CHANGED',
  'activation-changed': 'ACCOUNT_ACTIVATION_CHANGED',
  'role-changed': 'ACCOUNT_ROLE_CHANGED',
  'worker-deleted': 'ACCOUNT_DEACTIVATED_BY_WORKER_DELETION',
};

const messages: Record<AccountManagementAction, string> = {
  'account-created': 'Medical-worker account created.',
  'password-changed': 'Medical-worker account password changed.',
  'activation-changed': 'Medical-worker account activation state changed.',
  'role-changed': 'Medical-worker role changed.',
  'worker-deleted': 'Account deactivated because its medical worker was deleted.',
};

export async function recordAccountManagementChange(
  transaction: Prisma.TransactionClient,
  change: AccountManagementChange,
): Promise<void> {
  await auditService.record(transaction, {
    eventType: eventTypes[change.action],
    actor:
      change.actor.type === 'admin'
        ? { type: 'admin', administratorId: change.actor.administratorId }
        : { type: 'system', identifier: 'medical-worker-deletion' },
    message: messages[change.action],
    metadata: {
      targetAccountId: change.accountId,
      medicalWorkerId: change.medicalWorkerId,
      revokedRefreshTokens: change.revokedRefreshTokens,
    },
  });
}
