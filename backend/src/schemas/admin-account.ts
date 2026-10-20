import { z } from 'zod';

export const accountIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const createAccountSchema = z
  .object({
    username: z.string().trim().min(3).max(16),
    medicalWorkerId: z.number().int().positive(),
  })
  .strict();

export const accountStatusSchema = z.object({ isActive: z.boolean() }).strict();

export const accountRoleSchema = z
  .object({ role: z.enum(['doctor', 'laboratory-technician', 'nurse', 'other']) })
  .strict();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type AccountRoleInput = z.infer<typeof accountRoleSchema>;
