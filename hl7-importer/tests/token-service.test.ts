import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationStore } from '../src/main/configuration/store.js';
import { TokenService } from '../src/main/auth/token-service.js';
import type { ConnectionInput } from '../src/shared/types.js';

const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });
const secrets = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (value: Uint8Array) => Buffer.from(value).toString() };
const input: ConnectionInput = { hisUrl: 'https://localhost:3001', mllpHost: '127.0.0.1', mllpPort: 2575, tlsServerName: 'localhost', sourceSystemId: 'TEST-SOURCE', apiKey: 'msk_abcdefghijklmnopqrstuvwxyz', clientCertificatePath: 'client.pem', clientKeyPath: 'client.key', caCertificatePath: 'ca.pem', timeoutMs: 5_000 };

function store() { const directory = mkdtempSync(join(tmpdir(), 'hl7-token-test-')); directories.push(directory); return new ConfigurationStore(join(directory, 'settings.json'), secrets); }

describe('TokenService', () => {
  it('exchanges the API key, verifies HL7 role and rotates a persisted refresh token', async () => {
    const requester = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', expiresIn: 60 } })
      .mockResolvedValueOnce({ status: 200, body: { status: 'connected', role: 'HL7_IMPORT' } });
    const configuration = store();
    const service = new TokenService(configuration, requester as any);
    const established = await service.establish(input);
    await service.commit(established.settings);
    expect(established.accessToken).toBe('access-1');
    expect(configuration.settings()).not.toHaveProperty('apiKey');

    const refreshRequester = vi.fn().mockResolvedValue({ status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 60 } });
    const restarted = new TokenService(configuration, refreshRequester as any);
    expect(await restarted.token()).toBe('access-2');
    expect(refreshRequester.mock.calls[0]?.[0]).toContain('/api/service-auth/refresh');
    expect(await configuration.refreshToken()).toBe('refresh-2');
  });

  it('distinguishes a valid account without the HL7 Import role', async () => {
    const requester = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', expiresIn: 60 } })
      .mockResolvedValueOnce({ status: 200, body: { status: 'connected', role: 'LIS' } });
    await expect(new TokenService(store(), requester as any).establish(input)).rejects.toThrow('не имеет роли HL7 Import');
  });
});
