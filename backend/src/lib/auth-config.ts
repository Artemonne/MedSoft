import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { importPKCS8, importSPKI } from 'jose';

const defaultKeyDirectory = new URL('../../../certificates/local/', import.meta.url);

function positiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonEmpty(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!value.trim()) {
    throw new Error(`${name} must not be empty.`);
  }
  return value;
}

export function getAuthConfiguration() {
  return {
    accessTokenTtlSeconds: positiveInteger('ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
    refreshTokenTtlSeconds: positiveInteger('REFRESH_TOKEN_TTL_SECONDS', 7 * 24 * 60 * 60),
    issuer: nonEmpty('JWT_ISSUER', 'medsoft-api'),
    audience: nonEmpty('JWT_AUDIENCE', 'medsoft-client'),
  };
}

let signingKeyPromise: Promise<CryptoKey> | undefined;
let verificationKeyPromise: Promise<CryptoKey> | undefined;

export function getJwtSigningKey(): Promise<CryptoKey> {
  signingKeyPromise ??= (async () => {
    const path =
      process.env.JWT_PRIVATE_KEY_PATH ??
      fileURLToPath(new URL('jwt-private.key.pem', defaultKeyDirectory));
    return importPKCS8(await readFile(path, 'utf8'), 'EdDSA');
  })();
  return signingKeyPromise;
}

export function getJwtVerificationKey(): Promise<CryptoKey> {
  verificationKeyPromise ??= (async () => {
    const path =
      process.env.JWT_PUBLIC_KEY_PATH ??
      fileURLToPath(new URL('jwt-public.pem', defaultKeyDirectory));
    return importSPKI(await readFile(path, 'utf8'), 'EdDSA');
  })();
  return verificationKeyPromise;
}
