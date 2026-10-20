import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  omit: {
    account: { passwordHash: true },
    systemAdministrator: { passwordHash: true, totpSecret: true },
    refreshSession: { tokenHash: true },
  },
});
