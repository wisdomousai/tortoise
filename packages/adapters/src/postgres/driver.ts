/** A value bound to or returned from Postgres. BIGINT columns can come back as strings. */
export type PgValue = string | number | boolean | null;

/** Statements inside one transaction, on one connection. Parameters are `$1`, `$2`, ... */
export interface PgQuery {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly PgValue[]): Promise<Row[]>;
}

/**
 * The Postgres calls the workspace storage and the workspace lease need, so the same code runs on
 * `Bun.SQL` against a server and on PGlite in tests. A driver may pool connections: every
 * statement of one `transaction` runs on the same one, and a rejected callback rolls it back.
 */
export interface PgDriver {
  transaction<T>(fn: (tx: PgQuery) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Serialize work on a lock key for the rest of the transaction, across every connection. */
export const lockKey = (tx: PgQuery, key: string) =>
  tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
