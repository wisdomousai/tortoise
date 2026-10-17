import type { SqlDriver, SqlValue } from '../sql-driver';

/** A driver that can also return every row of a query, which reading a workspace needs. */
export interface SqlRowsDriver extends SqlDriver {
  all<Row>(sql: string, ...params: SqlValue[]): Row[];
}

/** Schema version 2 stores one row per record; version 1 stored one JSON document. */
export const ROW_SCHEMA_VERSION = 2;

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
 * Create the row tables, or convert a version 1 file in place: every stored document becomes
 * rows through `write`, then the document table is dropped. Runs in one immediate transaction,
 * so a crash leaves the file at version 1. A file from a newer version is refused; a version 1
 * reader refuses a version 2 file, so an older host never reads half a workspace.
 */
export function openSchema(
  driver: SqlRowsDriver,
  write: (workspaceId: string, document: string) => void,
): void {
  driver.exec('BEGIN IMMEDIATE');
  try {
    driver.exec('CREATE TABLE IF NOT EXISTS framework_schema (version INTEGER NOT NULL);');
    const row = driver.get<{ version: number }>('SELECT version FROM framework_schema');
    if (row && row.version !== 1 && row.version !== ROW_SCHEMA_VERSION)
      throw new Error('Unsupported storage schema version');
    for (const sql of tables) driver.exec(sql);
    if (!row) driver.run('INSERT INTO framework_schema VALUES (?)', ROW_SCHEMA_VERSION);
    if (row?.version === 1) {
      const legacy = driver.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_snapshots'",
      );
      if (legacy)
        for (const { workspace_id, document } of driver.all<{
          workspace_id: string;
          document: string;
        }>('SELECT workspace_id, document FROM workspace_snapshots'))
          write(workspace_id, document);
      driver.exec('DROP TABLE IF EXISTS workspace_snapshots');
      driver.run('UPDATE framework_schema SET version = ?', ROW_SCHEMA_VERSION);
    }
    driver.exec('COMMIT');
  } catch (error) {
    driver.exec('ROLLBACK');
    throw error;
  }
}
