import { z } from 'zod';
export const createServiceAccountSchema = z.object({ name: z.string().trim().min(3).max(100) }).strict();
export const serviceAccountIdSchema = z.object({ id: z.string().uuid() }).strict();
export const serviceAccountStatusSchema = z.object({ isActive: z.boolean() }).strict();
export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;
