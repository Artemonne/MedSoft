import { z } from 'zod';

const totpCode = z.string().regex(/^\d{6}$/);

export const adminBootstrapStartSchema = z
  .object({
    password: z.string().min(12).max(128),
    passwordConfirmation: z.string().min(12).max(128),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Passwords do not match.',
  });

export const adminBootstrapCompleteSchema = z.object({ totpCode }).strict();

export const adminLoginSchema = z
  .object({
    password: z.string().min(1).max(1024),
    totpCode,
  })
  .strict();

export type AdminBootstrapStartInput = z.infer<typeof adminBootstrapStartSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
