import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const migrations = [{ version: 1, sql: `
  CREATE TABLE connection_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    connection_id TEXT NOT NULL UNIQUE,
    his_url TEXT NOT NULL,
    encrypted_refresh_token BLOB NOT NULL,
    fhir_version TEXT NOT NULL,
    last_checked_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
` }];

export interface StoredConnection { connectionId: string; hisUrl: string; encryptedRefreshToken: Uint8Array; fhirVersion: string; lastCheckedAt: string }

export class LisDatabase {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
    this.migrate();
  }
  private migrate() {
    const current = Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version);
    for (const migration of migrations.filter((item) => item.version > current)) {
      this.db.exec('BEGIN IMMEDIATE');
      try { this.db.exec(migration.sql); this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString()); this.db.exec('COMMIT'); }
      catch (error) { this.db.exec('ROLLBACK'); throw new Error('Не удалось обновить локальную базу LIS.', { cause: error }); }
    }
  }
  getConnection(): StoredConnection | null {
    const row = this.db.prepare('SELECT connection_id, his_url, encrypted_refresh_token, fhir_version, last_checked_at FROM connection_config WHERE id = 1').get() as Record<string, unknown> | undefined;
    return row ? { connectionId: String(row.connection_id), hisUrl: String(row.his_url), encryptedRefreshToken: row.encrypted_refresh_token as Uint8Array, fhirVersion: String(row.fhir_version), lastCheckedAt: String(row.last_checked_at) } : null;
  }
  saveConnection(input: Omit<StoredConnection, 'connectionId'>, connectionId: string = randomUUID()) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO connection_config(id, connection_id, his_url, encrypted_refresh_token, fhir_version, last_checked_at, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, his_url=excluded.his_url, encrypted_refresh_token=excluded.encrypted_refresh_token, fhir_version=excluded.fhir_version, last_checked_at=excluded.last_checked_at, updated_at=excluded.updated_at`).run(connectionId, input.hisUrl, input.encryptedRefreshToken, input.fhirVersion, input.lastCheckedAt, now, now);
    return connectionId;
  }
  updateSecret(encrypted: Uint8Array, checkedAt: string) { this.db.prepare('UPDATE connection_config SET encrypted_refresh_token = ?, last_checked_at = ?, updated_at = ? WHERE id = 1').run(encrypted, checkedAt, checkedAt); }
  clearConnection() { this.db.prepare('DELETE FROM connection_config WHERE id = 1').run(); }
  close() { this.db.close(); }
}
