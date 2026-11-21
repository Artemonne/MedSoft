import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashSecret, verifySecret } from './secret-kdf.js';

const PREFIX = 'msk';
const LEGACY_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function legacyHashServiceApiSecret(secret: string): string {
  return createHash('sha256').update('medsoft:service-api-key:v1\0', 'utf8').update(secret, 'utf8').digest('base64url');
}
export async function generateServiceApiKey() {
  const keyId = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return { keyId, apiKey: `${PREFIX}_${keyId}_${secret}`, apiKeyHash: await hashSecret(secret) };
}
export function parseServiceApiKey(apiKey: string): { keyId: string; secret: string } | null {
  const match = apiKey.match(/^msk_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/);
  return match ? { keyId: match[1], secret: match[2] } : null;
}
export async function verifyServiceApiSecret(stored: string, secret: string): Promise<{ matches: boolean; needsUpgrade: boolean }> {
  if (!LEGACY_HASH_PATTERN.test(stored)) return { matches: await verifySecret(secret, stored), needsUpgrade: false };
  const actual = Buffer.from(stored); const presented = Buffer.from(legacyHashServiceApiSecret(secret));
  return { matches: actual.length === presented.length && timingSafeEqual(actual, presented), needsUpgrade: true };
}
export function maskedServiceKeyId(keyId: string): string { return `msk_${keyId.slice(0, 6)}…`; }
