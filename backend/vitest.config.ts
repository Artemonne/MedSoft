import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/health.test.ts',
      'tests/medical-record-replay.test.ts',
      'tests/password.test.ts',
      'tests/test-database-guard.test.ts',
      'tests/test-suite-classification.test.ts',
      'tests/totp.test.ts',
      'tests/worker-account-validation.test.ts',
    ],
  },
});
