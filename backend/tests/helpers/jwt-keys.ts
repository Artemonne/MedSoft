import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function installTestJwtKeys() {
  const directory = mkdtempSync(join(tmpdir(), 'medsoft-jwt-'));
  const privateKeyPath = join(directory, 'private.pem');
  const publicKeyPath = join(directory, 'public.pem');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });

  const previousPrivatePath = process.env.JWT_PRIVATE_KEY_PATH;
  const previousPublicPath = process.env.JWT_PUBLIC_KEY_PATH;
  process.env.JWT_PRIVATE_KEY_PATH = privateKeyPath;
  process.env.JWT_PUBLIC_KEY_PATH = publicKeyPath;

  return {
    privateKey,
    privateKeyPath,
    cleanup() {
      if (previousPrivatePath === undefined) {
        delete process.env.JWT_PRIVATE_KEY_PATH;
      } else {
        process.env.JWT_PRIVATE_KEY_PATH = previousPrivatePath;
      }
      if (previousPublicPath === undefined) {
        delete process.env.JWT_PUBLIC_KEY_PATH;
      } else {
        process.env.JWT_PUBLIC_KEY_PATH = previousPublicPath;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
