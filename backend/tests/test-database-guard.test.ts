import { afterEach, describe, expect, it } from 'vitest';
import { requireTestDatabaseConfiguration } from '../src/lib/test-database-guard.js';

const originalTestUrl = process.env.TEST_DATABASE_URL;
const originalConfirmation = process.env.TEST_DATABASE_CONFIRMATION;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalTestUrl === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = originalTestUrl;
  if (originalConfirmation === undefined) delete process.env.TEST_DATABASE_CONFIRMATION;
  else process.env.TEST_DATABASE_CONFIRMATION = originalConfirmation;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('integration test database guard', () => {
  it('rejects a run without an explicit test connection', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => requireTestDatabaseConfiguration()).toThrow('TEST_DATABASE_URL is required');
  });

  it('rejects unsafe names and missing explicit confirmation', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://his_test_user:secret@localhost:5432/his';
    process.env.TEST_DATABASE_CONFIRMATION = 'his/his_test_user';
    expect(() => requireTestDatabaseConfiguration()).toThrow('separate test segment');

    process.env.TEST_DATABASE_URL =
      'postgresql://his_test_user:secret@localhost:5432/medsoft_test?schema=public';
    delete process.env.TEST_DATABASE_CONFIRMATION;
    expect(() => requireTestDatabaseConfiguration()).toThrow('must exactly match');
  });

  it('rejects the configured development database even if its name looks like a test database', () => {
    const url = 'postgresql://his_test_user:secret@localhost:5432/medsoft_test?schema=public';
    process.env.DATABASE_URL = url;
    process.env.TEST_DATABASE_URL = url;
    process.env.TEST_DATABASE_CONFIRMATION = 'medsoft_test/his_test_user';
    expect(() => requireTestDatabaseConfiguration()).toThrow('configured development database');
  });

  it('accepts a separately named and explicitly confirmed candidate', () => {
    delete process.env.DATABASE_URL;
    process.env.TEST_DATABASE_URL =
      'postgresql://his_test_user:secret@localhost:5432/medsoft_test?schema=public';
    process.env.TEST_DATABASE_CONFIRMATION = 'medsoft_test/his_test_user';
    expect(requireTestDatabaseConfiguration()).toMatchObject({
      databaseName: 'medsoft_test',
      userName: 'his_test_user',
    });
  });

  it('allows the runner to mirror the verified test URL into DATABASE_URL', () => {
    const url = 'postgresql://his_test_user:secret@localhost:5432/medsoft_test?schema=public';
    process.env.DATABASE_URL = url;
    process.env.TEST_DATABASE_URL = url;
    process.env.TEST_DATABASE_CONFIRMATION = 'medsoft_test/his_test_user';
    expect(
      requireTestDatabaseConfiguration({ allowDatabaseUrlMirror: true }),
    ).toMatchObject({ databaseName: 'medsoft_test', userName: 'his_test_user' });
  });
});
