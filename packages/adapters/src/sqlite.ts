import { Database } from 'bun:sqlite';
import { RowStorage, type RowStorageOptions, type SqlRowsDriver } from './row-storage';
import type { SqlValue } from './sql-driver';

/**
 * `bun:sqlite` as a `SqlRowsDriver`, in write-ahead mode with full sync and a five-second wait
 * for a lock another connection holds.
 */
export function bunSqlDriver(path: string): SqlRowsDriver {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  return {
    exec: (sql) => void db.exec(sql),
    get: <Row>(sql: string, ...params: SqlValue[]) => db.query(sql).get(...params) as Row | null,
    all: <Row>(sql: string, ...params: SqlValue[]) => db.query(sql).all(...params) as Row[],
    run: (sql, ...params) => void db.query(sql).run(...params),
    close: () => db.close(true),
  };
}

/**
 * Workspace persistence in one SQLite file, one row per record (`RowStorage`). A file written as
 * one JSON document per workspace is converted on open. Features can replace this with
 * transaction-bound repositories.
 */
export class SQLiteStorage<State> extends RowStorage<State> {
  /** See `RowStorage` for `upgrade`, `depth` and `retention`. */
  constructor(path: string, initialState: () => State, options: RowStorageOptions<State> = {}) {
    super(bunSqlDriver(path), initialState, options);
  }
}
