import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'msk';
export function hashServiceApiSecret(secret: string): string {
  return createHash('sha256').update('medsoft:service-api-key:v1\0', 'utf8').update(secret, 'utf8').digest('base64url');
}
export function generateServiceApiKey() {
  const keyId = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return { keyId, apiKey: `${PREFIX}_${keyId}_${secret}`, apiKeyHash: hashServiceApiSecret(secret) };
}
export function parseServiceApiKey(apiKey: string): { keyId: string; secret: string } | null {
  const match = apiKey.match(/^msk_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/);
  return match ? { keyId: match[1], secret: match[2] } : null;
}
export function serviceApiHashMatches(stored: string, secret: string): boolean {
  const actual = Buffer.from(stored); const presented = Buffer.from(hashServiceApiSecret(secret));
  return actual.length === presented.length && timingSafeEqual(actual, presented);
}
export function maskedServiceKeyId(keyId: string): string { return `msk_${keyId.slice(0, 6)}…`; }
