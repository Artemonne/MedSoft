import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password KDF', () => {
  it('hashes and verifies the correct password', async () => {
    const password = 'Correct horse battery staple 370553';
    const encodedHash = await hashPassword(password);

    expect(encodedHash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(encodedHash).not.toContain(password);
    await expect(verifyPassword(password, encodedHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', encodedHash)).resolves.toBe(false);
  });

  it('uses a fresh random salt for every hash', async () => {
    const password = 'Same password 370553';
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);

    expect(first).not.toBe(second);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword(password, second)).resolves.toBe(true);
  });

  it('rejects malformed hashes without throwing', async () => {
    await expect(verifyPassword('password', 'not-a-password-hash')).resolves.toBe(false);
  });
});
