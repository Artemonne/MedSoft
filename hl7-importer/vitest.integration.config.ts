import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/his-e2e.integration.ts'],
    setupFiles: ['../backend/tests/setup-integration.ts'],
    fileParallelism: false,
  },
});
