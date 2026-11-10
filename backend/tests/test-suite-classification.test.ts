import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const unitTests = [
  'health.test.ts',
  'medical-record-replay.test.ts',
  'password.test.ts',
  'test-database-guard.test.ts',
  'test-suite-classification.test.ts',
  'totp.test.ts',
  'worker-account-validation.test.ts',
];

const integrationTests = [
  'admin-accounts.test.ts',
  'admin-auth.test.ts',
  'audit.test.ts',
  'auth.test.ts',
  'authorization.test.ts',
  'core-crud.test.ts',
  'medical-record.test.ts',
  'laboratory.test.ts',
  'security-model.test.ts',
  'worker-account-migration.test.ts',
];

describe('backend test suite classification', () => {
  it('classifies every backend test as unit or database integration', () => {
    const actual = readdirSync(new URL('.', import.meta.url))
      .filter((name) => name.endsWith('.test.ts'))
      .sort();
    expect([...unitTests, ...integrationTests].sort()).toEqual(actual);
  });

  it('keeps database-changing tests out of the default unit suite', () => {
    expect(unitTests).not.toContain('audit.test.ts');
    expect(unitTests).not.toContain('admin-auth.test.ts');
    expect(unitTests).not.toContain('worker-account-migration.test.ts');
  });
});
