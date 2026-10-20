import { Prisma, RefreshSessionSubjectType } from '@prisma/client';

export async function lockAccount(
  transaction: Prisma.TransactionClient,
  accountId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Account"
    WHERE "id" = ${accountId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

export async function revokeActiveAccountSessions(
  transaction: Prisma.TransactionClient,
  accountId: string,
  reason: string,
  revokedAt: Date,
): Promise<number> {
  const result = await transaction.refreshSession.updateMany({
    where: {
      subjectType: RefreshSessionSubjectType.USER,
      accountId,
      revokedAt: null,
      expiresAt: { gt: revokedAt },
    },
    data: { revokedAt, revocationReason: reason },
  });
  return result.count;
}
