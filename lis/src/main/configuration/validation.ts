import { z } from 'zod';

export const connectionInputSchema = z.object({
  hisUrl: z.string().trim().url().max(2048), apiKey: z.string().min(1).max(200),
}).strict().transform((input, context) => {
  const url = new URL(input.hisUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'Укажите HTTPS-адрес HIS без credentials, query или fragment.' }); return z.NEVER;
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    context.addIssue({ code: 'custom', message: 'Укажите базовый адрес HIS без API-пути.' }); return z.NEVER;
  }
  return { hisUrl: url.origin, apiKey: input.apiKey };
});
