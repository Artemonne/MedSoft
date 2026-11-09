import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

export const TEST_GUARD_ID = 'medsoft-integration-tests-v1';

export interface TestDatabaseIdentity {
  databaseName: string;
  userName: string;
  url: string;
}

function developmentUrlFromFile(): string | undefined {
  try {
    const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    const match = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function requireTestDatabaseConfiguration(options?: {
  allowDatabaseUrlMirror?: boolean;
}): TestDatabaseIdentity {
  const rawUrl = process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error('TEST_DATABASE_URL is required for integration tests.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const userName = decodeURIComponent(parsed.username);
  if (!databaseName || !userName) {
    throw new Error('TEST_DATABASE_URL must identify both a database and a user.');
  }
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error('The integration database name must contain a separate test segment.');
  }
  if (['postgres', 'his', 'medsoft'].includes(databaseName.toLowerCase())) {
    throw new Error('The integration database must not use a development or administrative database name.');
  }
  if (process.env.TEST_DATABASE_CONFIRMATION !== `${databaseName}/${userName}`) {
    throw new Error('TEST_DATABASE_CONFIRMATION must exactly match <database>/<user>.');
  }

  const developmentUrls = [
    developmentUrlFromFile(),
    options?.allowDatabaseUrlMirror && process.env.DATABASE_URL === rawUrl
      ? undefined
      : process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  for (const developmentUrl of developmentUrls) {
    try {
      const development = new URL(developmentUrl);
      if (
        development.hostname === parsed.hostname &&
        (development.port || '5432') === (parsed.port || '5432') &&
        decodeURIComponent(development.pathname) === decodeURIComponent(parsed.pathname)
      ) {
        throw new Error('TEST_DATABASE_URL resolves to the configured development database.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('configured development database')) {
        throw error;
      }
    }
  }

  return { databaseName, userName, url: rawUrl };
}

export async function verifyTestDatabaseServer(
  identity: TestDatabaseIdentity,
  options: { requireMarker: boolean },
): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: identity.url });
  try {
    const [server] = await client.$queryRaw<
      Array<{ databaseName: string; userName: string; isSuperuser: boolean }>
    >`
      SELECT current_database() AS "databaseName",
             current_user AS "userName",
             usesuper AS "isSuperuser"
      FROM pg_user
      WHERE usename = current_user
    `;
    if (!server || server.databaseName !== identity.databaseName || server.userName !== identity.userName) {
      throw new Error('The PostgreSQL server identity does not match TEST_DATABASE_URL.');
    }
    if (server.isSuperuser) {
      throw new Error('Integration tests require a dedicated non-superuser PostgreSQL role.');
    }
    if (options.requireMarker) {
      const marker = await client.$queryRaw<Array<{ databaseName: string; userName: string }>>`
        SELECT "databaseName", "userName"
        FROM "_IntegrationTestGuard"
        WHERE "id" = ${TEST_GUARD_ID}
      `;
      if (
        marker.length !== 1 ||
        marker[0].databaseName !== identity.databaseName ||
        marker[0].userName !== identity.userName
      ) {
        throw new Error('The database is not prepared for MedSoft integration tests.');
      }
    }
  } finally {
    await client.$disconnect();
  }
}
