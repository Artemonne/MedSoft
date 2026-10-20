import { z } from 'zod';

export const loginSchema = z
  .object({
    username: z.string().trim().min(3).max(16),
    password: z.string().min(1).max(1024),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
