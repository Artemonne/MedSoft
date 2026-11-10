import { Prisma, RefreshSessionSubjectType } from '@prisma/client';
export async function lockServiceAccount(transaction: Prisma.TransactionClient, id: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "ServiceAccount" WHERE "id" = ${id}::uuid FOR UPDATE`);
  return rows.length === 1;
}
export async function revokeServiceSessions(transaction: Prisma.TransactionClient, id: string, reason: string, at: Date) {
  const result = await transaction.refreshSession.updateMany({ where: { subjectType: RefreshSessionSubjectType.SERVICE, serviceAccountId: id, revokedAt: null }, data: { revokedAt: at, revocationReason: reason } });
  return result.count;
}
