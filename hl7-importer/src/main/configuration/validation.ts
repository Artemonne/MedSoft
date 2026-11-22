import { z } from 'zod';

const path = z.string().trim().min(1, 'Выберите файл.').max(1_024);
export const settingsSchema = z.object({
  hisUrl: z.string().trim().url().transform((value, context) => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      context.addIssue({ code: 'custom', message: 'Допустим только HTTP(S) URL без credentials, query и fragment.' });
      return z.NEVER;
    }
    if (url.pathname !== '/' && url.pathname !== '') {
      context.addIssue({ code: 'custom', message: 'Base URL не должен содержать путь.' });
      return z.NEVER;
    }
    return url.origin;
  }),
  mllpHost: z.string().trim().min(1).max(253),
  mllpPort: z.coerce.number().int().min(1).max(65_535),
  tlsServerName: z.string().trim().min(1).max(253),
  sourceSystemId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/, 'Source System ID: 1–100 латинских букв, цифр, точек, подчёркиваний или дефисов.'),
  clientCertificatePath: path,
  clientKeyPath: path,
  caCertificatePath: path,
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000),
}).strict();

export const connectionInputSchema = settingsSchema.extend({ apiKey: z.string().trim().min(20).max(512) }).strict();
