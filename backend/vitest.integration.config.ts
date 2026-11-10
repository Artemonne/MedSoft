import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: [
      'tests/admin-accounts.test.ts',
      'tests/admin-auth.test.ts',
      'tests/audit.test.ts',
      'tests/auth.test.ts',
      'tests/authorization.test.ts',
      'tests/core-crud.test.ts',
      'tests/fhir-r5.test.ts',
      'tests/fhir-observation-create.test.ts',
      'tests/medical-record.test.ts',
      'tests/laboratory.test.ts',
      'tests/security-model.test.ts',
      'tests/service-auth.test.ts',
      'tests/worker-account-migration.test.ts',
    ],
    setupFiles: ['./tests/setup-integration.ts'],
  },
});
