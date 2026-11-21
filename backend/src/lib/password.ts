import { hashSecret, verifySecret } from './secret-kdf.js';

export async function hashPassword(password: string): Promise<string> {
  return hashSecret(password);
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  return verifySecret(password, encodedHash);
}
