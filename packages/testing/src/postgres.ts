import { PGlite } from '@electric-sql/pglite';
import type { PgDriver, PgQuery, PgValue } from '@tortoise/adapters/postgres-storage';

/**
 * An in-process Postgres (PGlite, Postgres compiled to WebAssembly) behind `PgDriver`, for the
 * storage conformance suite and lease tests without a server. One instance is one connection, so
 * its transactions run one after another: several drivers over one `database` model hosts that
 * share a database, without interleaving their statements. `close` closes the database.
 */
export function pgliteDriver(database = new PGlite()): PgDriver & { readonly database: PGlite } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    database,
    transaction<T>(fn: (tx: PgQuery) => Promise<T>): Promise<T> {
      const run = () =>
        database.transaction((tx) =>
          fn({
            query: async <Row>(sql: string, params: readonly PgValue[] = []) =>
              (await tx.query<Row>(sql, [...params])).rows,
          }),
        );
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    close: () => database.close(),
  };
}
