import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LisDatabase } from '../src/main/database/index.js';
const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('LIS SQLite', () => {
  it('initializes, migrates and preserves connection data across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'medsoft-lis-')); paths.push(dir); const path = join(dir, 'lis.sqlite');
    const first = new LisDatabase(path); first.saveConnection({ hisUrl: 'https://his.test', encryptedRefreshToken: new Uint8Array([1, 2, 3]), fhirVersion: '5.0.0', lastCheckedAt: '2026-11-10T00:00:00.000Z' }, 'connection-a'); first.close();
    const second = new LisDatabase(path); expect(second.getConnection()).toMatchObject({ connectionId: 'connection-a', hisUrl: 'https://his.test', fhirVersion: '5.0.0' }); expect([...second.getConnection()!.encryptedRefreshToken]).toEqual([1, 2, 3]); second.close();
  });
  it('reports an unavailable database path', () => { expect(() => new LisDatabase(join('Z:\\missing-drive', 'lis.sqlite'))).toThrow(); });
});
