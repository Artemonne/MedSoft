import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import {
  TEST_GUARD_ID,
  requireTestDatabaseConfiguration,
  verifyTestDatabaseServer,
} from '../src/lib/test-database-guard.js';

const identity = requireTestDatabaseConfiguration();
const environment = {
  ...process.env,
  DATABASE_URL: identity.url,
  NODE_ENV: 'test',
};

await verifyTestDatabaseServer(identity, { requireMarker: false });

const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const migration = spawnSync(executable, ['exec', '--', 'prisma', 'migrate', 'deploy'], {
  cwd: new URL('..', import.meta.url),
  env: environment,
  stdio: 'inherit',
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

const client = new PrismaClient({ datasourceUrl: identity.url });
try {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_IntegrationTestGuard" (
      "id" TEXT PRIMARY KEY,
      "databaseName" TEXT NOT NULL,
      "userName" TEXT NOT NULL,
      "preparedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw`
    INSERT INTO "_IntegrationTestGuard" ("id", "databaseName", "userName")
    VALUES (${TEST_GUARD_ID}, ${identity.databaseName}, ${identity.userName})
    ON CONFLICT ("id") DO UPDATE
    SET "databaseName" = EXCLUDED."databaseName",
        "userName" = EXCLUDED."userName",
        "preparedAt" = CURRENT_TIMESTAMP
  `;
} finally {
  await client.$disconnect();
}

await verifyTestDatabaseServer(identity, { requireMarker: true });

const tests = spawnSync(executable, ['exec', '--', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
  cwd: new URL('..', import.meta.url),
  env: environment,
  stdio: 'inherit',
});
process.exit(tests.status ?? 1);
