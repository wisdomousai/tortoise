import { SQL } from 'bun';
import type { PgDriver, PgQuery, PgValue } from './postgres/driver';

const statements = (tx: SQL): PgQuery => ({
  query: <Row>(text: string, params: readonly PgValue[] = []) =>
    tx.unsafe<Row[]>(text, [...params]) as unknown as Promise<Row[]>,
});

/**
 * A `PgDriver` over Bun's built-in Postgres client, pooling up to `max` connections. The URL,
 * with its credentials, is launcher configuration: it never comes from content or workspace
 * state. The connection is the platform's own, like the SQLite file of a local workspace, and
 * opens before any plugin, so it does not pass through the network port.
 */
export function bunPostgres(url: string, options: { readonly max?: number } = {}): PgDriver {
  const sql = new SQL(url, { max: options.max ?? 4 });
  return {
    transaction: <T>(fn: (tx: PgQuery) => Promise<T>) =>
      sql.begin((tx) => fn(statements(tx))) as Promise<T>,
    close: () => sql.close(),
  };
}
