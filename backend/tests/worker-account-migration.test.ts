import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

afterAll(() => prisma.$disconnect());

it('migrates existing rows without changing names or usernames and preserves database constraints', async () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261030120000_worker_middle_name_username_32/migration.sql', import.meta.url), 'utf8');
  await prisma.$transaction(async (tx) => {
    // Temporary tables shadow application tables only for this connection.
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "MedicalWorker" (id INTEGER PRIMARY KEY, "firstName" VARCHAR(24), "lastName" VARCHAR(24)) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Account" (id INTEGER PRIMARY KEY, username VARCHAR(16) UNIQUE NOT NULL, CONSTRAINT "Account_username_length_check" CHECK (char_length(username) BETWEEN 3 AND 16)) ON COMMIT DROP');
    await tx.$executeRawUnsafe(`INSERT INTO "MedicalWorker" VALUES (1, 'Ivan', 'Ivanov')`);
    await tx.$executeRawUnsafe(`INSERT INTO "Account" VALUES (1, 'existing_login')`);
    for (const statement of sql.split(';').map((part) => part.trim()).filter((part) => part && part !== 'BEGIN' && part !== 'COMMIT')) {
      await tx.$executeRawUnsafe(statement);
    }
    expect(await tx.$queryRawUnsafe('SELECT * FROM "MedicalWorker"')).toEqual([
      { id: 1, firstName: 'Ivan', lastName: 'Ivanov', middleName: null },
    ]);
    expect(await tx.$queryRawUnsafe('SELECT username FROM "Account" WHERE id = 1')).toEqual([{ username: 'existing_login' }]);
    await tx.$executeRawUnsafe(`INSERT INTO "Account" VALUES (2, '${'a'.repeat(32)}')`);
    for (const username of ['ab', 'a'.repeat(33), 'existing_login']) {
      await tx.$executeRawUnsafe('SAVEPOINT boundary_check');
      await expect(tx.$executeRawUnsafe(`INSERT INTO "Account" VALUES (3, '${username}')`)).rejects.toThrow();
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT boundary_check');
    }
  });
});
