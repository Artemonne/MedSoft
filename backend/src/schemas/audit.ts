import { z } from 'zod';

const limit = z.coerce.number().int().min(1).max(100).default(50);

export const auditHistoryQuerySchema = z
  .object({ limit, before: z.string().min(1).max(512).optional() })
  .strict();

export const auditChangesQuerySchema = z
  .object({ limit, after: z.string().min(1).max(512).optional() })
  .strict();
