import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const migrations = [
  {
    version: 1,
    sql: `
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
`,
  },
  {
    version: 2,
    sql: `
  CREATE TABLE result_submission (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, service_request_id TEXT NOT NULL,
    identifier_system TEXT NOT NULL, identifier_value TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('PENDING','UNKNOWN','COMPLETED','CONFLICT')),
    observation_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(connection_id, service_request_id), UNIQUE(connection_id, identifier_system, identifier_value)
  ) STRICT;
  CREATE TABLE completed_analysis (
    id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, service_request_id TEXT NOT NULL, observation_id TEXT NOT NULL,
    identifier_system TEXT NOT NULL, identifier_value TEXT NOT NULL, snapshot_json TEXT NOT NULL, observation_json TEXT NOT NULL,
    effective_at TEXT NOT NULL, issued TEXT NOT NULL, confirmed_at TEXT NOT NULL,
    UNIQUE(connection_id, service_request_id), UNIQUE(connection_id, observation_id), UNIQUE(connection_id, identifier_system, identifier_value)
  ) STRICT;
`,
  },
  {
    version: 3,
    sql: `
  ALTER TABLE result_submission ADD COLUMN observation_cipher BLOB;
  ALTER TABLE result_submission ADD COLUMN snapshot_cipher BLOB;
  ALTER TABLE completed_analysis ADD COLUMN observation_cipher BLOB;
  ALTER TABLE completed_analysis ADD COLUMN snapshot_cipher BLOB;
`,
  },
];

export interface StoredConnection {
  connectionId: string;
  hisUrl: string;
  encryptedRefreshToken: Uint8Array;
  fhirVersion: string;
  lastCheckedAt: string;
}
export interface SubmissionRow {
  id: string;
  connectionId: string;
  serviceRequestId: string;
  identifierSystem: string;
  identifierValue: string;
  state: string;
  observationCipher: Uint8Array;
  snapshotCipher: Uint8Array;
}
export interface LegacyMedicalRow {
  table: "result_submission" | "completed_analysis";
  id: string;
  observationJson: string;
  snapshotJson: string;
}

export class LisDatabase {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;",
    );
    this.migrate();
  }
  private migrate() {
    const current = Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
          )
          .get() as { version: number }
      ).version,
    );
    for (const migration of migrations.filter(
      (item) => item.version > current,
    )) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migration.sql);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          )
          .run(migration.version, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw new Error("Не удалось обновить локальную базу LIS.", {
          cause: error,
        });
      }
    }
  }
  getConnection(): StoredConnection | null {
    const row = this.db
      .prepare(
        "SELECT connection_id, his_url, encrypted_refresh_token, fhir_version, last_checked_at FROM connection_config WHERE id = 1",
      )
      .get() as Record<string, unknown> | undefined;
    return row
      ? {
          connectionId: String(row.connection_id),
          hisUrl: String(row.his_url),
          encryptedRefreshToken: row.encrypted_refresh_token as Uint8Array,
          fhirVersion: String(row.fhir_version),
          lastCheckedAt: String(row.last_checked_at),
        }
      : null;
  }
  saveConnection(
    input: Omit<StoredConnection, "connectionId">,
    connectionId: string = randomUUID(),
  ) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO connection_config(id, connection_id, his_url, encrypted_refresh_token, fhir_version, last_checked_at, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, his_url=excluded.his_url, encrypted_refresh_token=excluded.encrypted_refresh_token, fhir_version=excluded.fhir_version, last_checked_at=excluded.last_checked_at, updated_at=excluded.updated_at`,
      )
      .run(
        connectionId,
        input.hisUrl,
        input.encryptedRefreshToken,
        input.fhirVersion,
        input.lastCheckedAt,
        now,
        now,
      );
    return connectionId;
  }
  updateSecret(encrypted: Uint8Array, checkedAt: string) {
    this.db
      .prepare(
        "UPDATE connection_config SET encrypted_refresh_token = ?, last_checked_at = ?, updated_at = ? WHERE id = 1",
      )
      .run(encrypted, checkedAt, checkedAt);
  }
  clearConnection() {
    this.db.prepare("DELETE FROM connection_config WHERE id = 1").run();
  }
  createSubmission(row: Omit<SubmissionRow, "state">) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        this.schemaVersion() >= 4 ? "INSERT INTO result_submission(id,connection_id,service_request_id,identifier_system,identifier_value,state,observation_cipher,snapshot_cipher,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',?,?,?,?)" : "INSERT INTO result_submission(id,connection_id,service_request_id,identifier_system,identifier_value,state,observation_json,snapshot_json,observation_cipher,snapshot_cipher,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING','','',?,?,?,?)",
      )
      .run(
        row.id,
        row.connectionId,
        row.serviceRequestId,
        row.identifierSystem,
        row.identifierValue,
        row.observationCipher,
        row.snapshotCipher,
        now,
        now,
      );
  }
  getSubmission(connectionId: string, requestId: string): SubmissionRow | null {
    const row = this.db
      .prepare(
        "SELECT id,connection_id,service_request_id,identifier_system,identifier_value,state,observation_cipher,snapshot_cipher FROM result_submission WHERE connection_id=? AND service_request_id=?",
      )
      .get(connectionId, requestId) as any;
    return row
      ? {
          id: row.id,
          connectionId: row.connection_id,
          serviceRequestId: row.service_request_id,
          identifierSystem: row.identifier_system,
          identifierValue: row.identifier_value,
          state: row.state,
          observationCipher: row.observation_cipher,
          snapshotCipher: row.snapshot_cipher,
        }
      : null;
  }
  markSubmission(id: string, state: "UNKNOWN" | "CONFLICT") {
    this.db
      .prepare("UPDATE result_submission SET state=?,updated_at=? WHERE id=?")
      .run(state, new Date().toISOString(), id);
  }
  completeSubmission(
    submission: SubmissionRow,
    observationId: string,
    observationCipher: Uint8Array,
    effectiveAt: string,
    issued: string,
  ) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          this.schemaVersion() >= 4 ? "INSERT OR IGNORE INTO completed_analysis(id,connection_id,service_request_id,observation_id,identifier_system,identifier_value,snapshot_cipher,observation_cipher,effective_at,issued,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)" : "INSERT OR IGNORE INTO completed_analysis(id,connection_id,service_request_id,observation_id,identifier_system,identifier_value,snapshot_json,observation_json,snapshot_cipher,observation_cipher,effective_at,issued,confirmed_at) VALUES(?,?,?,?,?,?,'','',?,?,?,?,?)",
        )
        .run(
          submission.id,
          submission.connectionId,
          submission.serviceRequestId,
          observationId,
          submission.identifierSystem,
          submission.identifierValue,
          submission.snapshotCipher,
          observationCipher,
          effectiveAt,
          issued,
          now,
        );
      this.db
        .prepare(
          "UPDATE result_submission SET state='COMPLETED',updated_at=? WHERE id=?",
        )
        .run(now, submission.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listHistoryRows() {
    return this.db
      .prepare(
        "SELECT id,service_request_id,observation_id,snapshot_cipher,observation_cipher,effective_at,issued,confirmed_at FROM completed_analysis ORDER BY confirmed_at DESC",
      )
      .all() as any[];
  }
  listOpenSubmissions() {
    return this.db
      .prepare(
        "SELECT id,connection_id,service_request_id,identifier_system,identifier_value,state,observation_cipher,snapshot_cipher FROM result_submission WHERE state IN ('PENDING','UNKNOWN','CONFLICT') ORDER BY updated_at DESC",
      )
      .all() as any[];
  }
  legacyMedicalRows(): LegacyMedicalRow[] {
    if (this.schemaVersion() >= 4) return [];
    const a = this.db
      .prepare(
        "SELECT id,observation_json,snapshot_json FROM result_submission WHERE observation_cipher IS NULL OR snapshot_cipher IS NULL",
      )
      .all() as any[];
    const b = this.db
      .prepare(
        "SELECT id,observation_json,snapshot_json FROM completed_analysis WHERE observation_cipher IS NULL OR snapshot_cipher IS NULL",
      )
      .all() as any[];
    return [
      ...a.map((r) => ({
        table: "result_submission" as const,
        id: r.id,
        observationJson: r.observation_json,
        snapshotJson: r.snapshot_json,
      })),
      ...b.map((r) => ({
        table: "completed_analysis" as const,
        id: r.id,
        observationJson: r.observation_json,
        snapshotJson: r.snapshot_json,
      })),
    ];
  }
  secureLegacyRows(
    rows: Array<{
      table: LegacyMedicalRow["table"];
      id: string;
      observationCipher: Uint8Array;
      snapshotCipher: Uint8Array;
    }>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows)
        this.db
          .prepare(
            `UPDATE ${row.table} SET observation_cipher=?,snapshot_cipher=?,observation_json='',snapshot_json='' WHERE id=?`,
          )
          .run(row.observationCipher, row.snapshotCipher, row.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  finalizeMedicalEncryption() {
    if (this.schemaVersion() >= 4) return;
    const missing = Number((this.db.prepare("SELECT (SELECT COUNT(*) FROM result_submission WHERE observation_cipher IS NULL OR snapshot_cipher IS NULL) + (SELECT COUNT(*) FROM completed_analysis WHERE observation_cipher IS NULL OR snapshot_cipher IS NULL) AS count").get() as { count: number }).count);
    if (missing) throw new Error("Не все медицинские записи зашифрованы.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("ALTER TABLE result_submission DROP COLUMN observation_json; ALTER TABLE result_submission DROP COLUMN snapshot_json; ALTER TABLE completed_analysis DROP COLUMN observation_json; ALTER TABLE completed_analysis DROP COLUMN snapshot_json;");
      this.db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)").run(new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private schemaVersion() { return Number((this.db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get() as { version: number }).version); }
  close() {
    this.db.close();
  }
}
