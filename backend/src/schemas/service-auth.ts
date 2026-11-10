import { z } from 'zod';
export const serviceTokenSchema = z.object({ apiKey: z.string().min(1).max(200) }).strict();
export const serviceRefreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();
