import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';
import type { PgDriver, PgQuery, PgValue } from '@tortoise/adapters/postgres-storage';

/**
 * An in-process Postgres (PGlite, Postgres compiled to WebAssembly) behind `PgDriver`, for the
 * storage conformance suite and lease tests without a server. One instance is one connection, so
 * its transactions run one after another: several drivers over one `database` model hosts that
 * share a database, without interleaving their statements. A transaction begun inside another,
 * as a blob read inside a commit is, runs on the open one: a server pool would give it a second
 * connection, and waiting for the only one would never end. `close` closes the database.
 */
const open = new AsyncLocalStorage<{ readonly database: PGlite; readonly tx: PgQuery }>();

export function pgliteDriver(database = new PGlite()): PgDriver & { readonly database: PGlite } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    database,
    transaction<T>(fn: (tx: PgQuery) => Promise<T>): Promise<T> {
      const outer = open.getStore();
      if (outer?.database === database) return fn(outer.tx);
      const run = () =>
        database.transaction((tx) => {
          const query: PgQuery = {
            query: async <Row>(sql: string, params: readonly PgValue[] = []) =>
              (await tx.query<Row>(sql, [...params])).rows,
          };
          return open.run({ database, tx: query }, () => fn(query));
        });
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    close: () => database.close(),
  };
}
