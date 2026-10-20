import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt);
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey, ...extra] =
    encodedHash.split('$');

  if (
    algorithm !== ALGORITHM ||
    Number(cost) !== COST ||
    Number(blockSize) !== BLOCK_SIZE ||
    Number(parallelization) !== PARALLELIZATION ||
    !encodedSalt ||
    !encodedKey ||
    extra.length > 0
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expectedKey = Buffer.from(encodedKey, 'base64url');
    if (salt.length !== SALT_LENGTH || expectedKey.length !== KEY_LENGTH) {
      return false;
    }
    const actualKey = await deriveKey(password, salt);
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}
