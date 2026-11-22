import { readFileSync } from 'node:fs';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { ImporterError, networkError } from '../errors.js';

export interface JsonResponse<T> { status: number; body: T }

export async function requestJson<T>(urlValue: string, input: {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  caCertificatePath?: string;
}): Promise<JsonResponse<T>> {
  let url: URL;
  try { url = new URL(urlValue); } catch (error) { throw networkError(error, 'HTTP API'); }
  const body = input.body === undefined ? null : JSON.stringify(input.body);
  const requester = url.protocol === 'https:' ? requestHttps : url.protocol === 'http:' ? requestHttp : null;
  if (!requester) throw new ImporterError('ADDRESS', 'HTTP API: поддерживаются только HTTP и HTTPS.');
  return new Promise((resolve, reject) => {
    const request = requester(url, {
      method: input.method ?? 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } : {}), ...input.headers },
      timeout: input.timeoutMs,
      ...(url.protocol === 'https:' ? {
        ca: input.caCertificatePath ? readFileSync(input.caCertificatePath) : undefined,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2' as const,
      } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 1_048_576) request.destroy(new Error('HTTP response is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const parsed = (text ? JSON.parse(text) : {}) as T;
          resolve({ status: response.statusCode ?? 0, body: parsed });
        } catch (error) { reject(new ImporterError('UNAVAILABLE', 'HTTP API вернул некорректный JSON.', { cause: error })); }
      });
    });
    request.once('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.once('error', (error) => reject(networkError(error, 'HTTP API')));
    if (body) request.write(body);
    request.end();
  });
}
