import type { Prisma } from '@prisma/client';

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

// Stage 7 will persist this event through the supplied transaction. Keeping the hook
// transaction-aware now prevents later audit writes from being detached from the mutation.
export async function recordAccountManagementChange(
  _transaction: Prisma.TransactionClient,
  _change: AccountManagementChange,
): Promise<void> {}
