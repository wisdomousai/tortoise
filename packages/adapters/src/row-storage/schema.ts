import { schemaVersionError, STORAGE_SCHEMA_VERSION } from '../schema-version';
import type { SqlDriver, SqlValue } from '../sql-driver';

/** A driver that can also return every row of a query, which reading a workspace needs. */
export interface SqlRowsDriver extends SqlDriver {
  all<Row>(sql: string, ...params: SqlValue[]): Row[];
}

/** One row per record, at the storage schema version (see `STORAGE_SCHEMA_VERSION`). */
export const ROW_SCHEMA_VERSION = STORAGE_SCHEMA_VERSION;

const tables = [
  `CREATE TABLE IF NOT EXISTS workspace_meta (
    workspace_id TEXT PRIMARY KEY,
    cursor INTEGER NOT NULL,
    authorization_revision INTEGER NOT NULL,
    journal_floor INTEGER NOT NULL DEFAULT 0,
    generation INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_rows (
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, kind, key)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_journal (
    workspace_id TEXT NOT NULL,
    cursor INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, cursor)
  )`,
];

/**
 * Create the row tables in one immediate transaction. A file from another schema version is
 * refused, and so is a file that `SnapshotStorage` wrote at this version, whose one-document
 * table this storage would otherwise ignore and show as an empty workspace.
 */
export function openSchema(driver: SqlRowsDriver): void {
  driver.exec('BEGIN IMMEDIATE');
  try {
    driver.exec('CREATE TABLE IF NOT EXISTS framework_schema (version INTEGER NOT NULL);');
    const row = driver.get<{ version: number }>('SELECT version FROM framework_schema');
    if (row && row.version !== ROW_SCHEMA_VERSION) throw schemaVersionError(row.version);
    const snapshots = driver.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshots'",
    );
    if (snapshots) throw new Error('The database holds snapshot storage, not row storage');
    for (const sql of tables) driver.exec(sql);
    if (!row) driver.run('INSERT INTO framework_schema VALUES (?)', ROW_SCHEMA_VERSION);
    driver.exec('COMMIT');
  } catch (error) {
    driver.exec('ROLLBACK');
    throw error;
  }
}
