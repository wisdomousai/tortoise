import { lockKey, type PgDriver } from './driver';

/** The row layout of the SQLite storage's version 2, with `seq` keeping stored order. */
export const PG_SCHEMA_VERSION = 2;

const tables = [
  `CREATE TABLE IF NOT EXISTS workspace_meta (
    workspace_id TEXT PRIMARY KEY,
    cursor BIGINT NOT NULL,
    authorization_revision BIGINT NOT NULL,
    journal_floor BIGINT NOT NULL DEFAULT 0,
    generation BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_rows (
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    seq BIGSERIAL,
    PRIMARY KEY (workspace_id, kind, key)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_journal (
    workspace_id TEXT NOT NULL,
    cursor BIGINT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, cursor)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_lease (
    workspace_id TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    fence BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
];

/**
 * Create the tables once per database. Hosts that start together take a lock first, because two
 * concurrent `CREATE TABLE IF NOT EXISTS` can still collide in Postgres. A database written by a
 * newer schema is refused, so an older host never reads half a workspace.
 */
export function openPgSchema(driver: PgDriver): Promise<void> {
  return driver.transaction(async (tx) => {
    await lockKey(tx, 'agent-native:schema');
    await tx.query('CREATE TABLE IF NOT EXISTS framework_schema (version INTEGER NOT NULL)');
    const [row] = await tx.query<{ version: number }>('SELECT version FROM framework_schema');
    if (row && Number(row.version) !== PG_SCHEMA_VERSION)
      throw new Error('Unsupported storage schema version');
    for (const sql of tables) await tx.query(sql);
    if (!row) await tx.query('INSERT INTO framework_schema VALUES ($1)', [PG_SCHEMA_VERSION]);
  });
}
