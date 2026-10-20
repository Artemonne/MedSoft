import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultSecretHashPath = new URL(
  '../../../certificates/local/admin-bootstrap.sha256',
  import.meta.url,
);

function secretHashPath(): string {
  return process.env.ADMIN_BOOTSTRAP_SECRET_HASH_PATH ?? fileURLToPath(defaultSecretHashPath);
}

async function expectedHash(): Promise<string | undefined> {
  if (process.env.ADMIN_BOOTSTRAP_SECRET_HASH) {
    return process.env.ADMIN_BOOTSTRAP_SECRET_HASH.trim().toLowerCase();
  }
  try {
    return (await readFile(secretHashPath(), 'utf8')).trim().toLowerCase();
  } catch {
    return undefined;
  }
}

export async function verifyBootstrapSecret(secret: string): Promise<boolean> {
  const expected = await expectedHash();
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    return false;
  }

  const actual = createHash('sha256').update(secret, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(expected, 'ascii'));
}

export async function consumeBootstrapSecret(): Promise<void> {
  if (process.env.ADMIN_BOOTSTRAP_SECRET_HASH) {
    return;
  }
  await unlink(secretHashPath()).catch(() => undefined);
}
