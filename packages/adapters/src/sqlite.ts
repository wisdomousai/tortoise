import { Database } from 'bun:sqlite';
import { SnapshotStorage } from './snapshot-storage';
import type { SqlDriver, SqlValue } from './sql-driver';

/**
 * `bun:sqlite` as a `SqlDriver`, in write-ahead mode with full sync and a five-second wait for a
 * lock another connection holds.
 */
export function bunSqlDriver(path: string): SqlDriver {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  return {
    exec: (sql) => void db.exec(sql),
    get: <Row>(sql: string, ...params: SqlValue[]) => db.query(sql).get(...params) as Row | null,
    run: (sql, ...params) => void db.query(sql).run(...params),
    close: () => db.close(true),
  };
}

/** Reference snapshot persistence in one SQLite file. Features can replace this with transaction-bound repositories. */
export class SQLiteStorage<State> extends SnapshotStorage<State> {
  /** See `SnapshotStorage` for `upgrade`. */
  constructor(
    path: string,
    initialState: () => State,
    options: { readonly upgrade?: (state: unknown) => State } = {},
  ) {
    super(bunSqlDriver(path), initialState, options);
  }
}
