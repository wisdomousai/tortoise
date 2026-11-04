import { beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { bunPostgres } from '@tortoise/adapters/postgres-bun';
import { WorkspaceOwnedError } from '@tortoise/adapters/exclusive-lock';
import {
  WorkspaceLeaseLostError,
  acquireWorkspaceLease,
  type WorkspaceLease,
} from '@tortoise/adapters/postgres-lease';
import { PostgresStorage, type PgDriver } from '@tortoise/adapters/postgres-storage';
import { pgliteDriver } from '../src/postgres';
import type { ConformanceState } from '../src/storage';

// Two hosts share one database: each has its own driver and storage, as two processes would.
// On PGlite they take turns on one connection; against a server (`STORAGE_POSTGRES_URL`) each
// has its own pool, so the race is a real one. Names are per run, so runs never collide.
interface Database {
  driver(): PgDriver;
  close(): Promise<void>;
}
const pglite = (): Database => {
  const database = new PGlite();
  return { driver: () => pgliteDriver(database), close: () => database.close() };
};
const url = process.env.STORAGE_POSTGRES_URL;
const server = (): Database => {
  const drivers: PgDriver[] = [];
  return {
    driver: () => drivers[drivers.push(bunPostgres(url!)) - 1]!,
    close: async () => void (await Promise.all(drivers.map((driver) => driver.close()))),
  };
};

const initial = (): ConformanceState => ({ count: 0, items: {} });
let plant = 'plant';
const host = (driver: PgDriver, lease: WorkspaceLease) =>
  new PostgresStorage(driver, initial, { scope: plant, fence: (tx) => lease.check(tx) });
const increment = (storage: PostgresStorage<ConformanceState>) =>
  storage.transact('local', async (snapshot) => {
    snapshot.state.count += 1;
  });

function leaseCases(open: () => Database) {
  test('two hosts race for one lease: only the holder commits, and a takeover fences the old one', async () => {
    const database = open();
    const [a, b] = [database.driver(), database.driver()];
    try {
      const results = await Promise.allSettled([
        acquireWorkspaceLease(a, plant, { ttlMs: 150 }),
        acquireWorkspaceLease(b, plant, { ttlMs: 150 }),
      ]);
      const won = results.filter((result) => result.status === 'fulfilled');
      const lost = results.filter((result) => result.status === 'rejected');
      expect(won).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(WorkspaceOwnedError);
      const first = (won[0] as PromiseFulfilledResult<WorkspaceLease>).value;
      const [firstDriver, secondDriver] = results[0]!.status === 'fulfilled' ? [a, b] : [b, a];
      const old = host(firstDriver, first);
      await increment(old);

      // The holder pauses past its expiry; the other host takes over with a larger fence.
      await Bun.sleep(200);
      const second = await acquireWorkspaceLease(secondDriver, plant, { ttlMs: 10_000 });
      expect(second.fence).toBe(first.fence + 1);
      const next = host(secondDriver, second);
      await increment(next);

      // The old holder wakes: its commit and its renewal are refused, and nothing it wrote is committed.
      await expect(increment(old)).rejects.toBeInstanceOf(WorkspaceLeaseLostError);
      await expect(first.renew()).rejects.toBeInstanceOf(WorkspaceLeaseLostError);
      await increment(next);
      await next.read('local', async (snapshot) => expect(snapshot.state.count).toBe(3));
    } finally {
      await database.close();
    }
  });

  test('a lease is renewed while held, and released for the next host without waiting', async () => {
    const database = open();
    const driver = database.driver();
    try {
      const lease = await acquireWorkspaceLease(driver, plant, { ttlMs: 150 });
      await Bun.sleep(100);
      await lease.renew();
      await Bun.sleep(100);
      // Still held: renewed past the first expiry.
      await expect(acquireWorkspaceLease(driver, plant)).rejects.toBeInstanceOf(
        WorkspaceOwnedError,
      );
      await increment(host(driver, lease));
      await lease.release();
      await lease.release();
      const next = await acquireWorkspaceLease(driver, plant);
      expect(next.fence).toBe(lease.fence + 1);
      await expect(increment(host(driver, lease))).rejects.toBeInstanceOf(WorkspaceLeaseLostError);
      // A different workspace has its own lease.
      expect((await acquireWorkspaceLease(driver, `${plant}-depot`)).fence).toBe(1);
    } finally {
      await database.close();
    }
  });

  test("a second storage's commit invalidates the first one's cached snapshot", async () => {
    const database = open();
    try {
      const [one, two] = [database.driver(), database.driver()].map(
        (driver) => new PostgresStorage(driver, initial),
      );
      await increment(one!);
      await increment(two!);
      await increment(one!);
      await one!.read('local', async (snapshot) => expect(snapshot.state.count).toBe(3));
      expect(one!.lastWrite).toEqual({ rows: 1, deletes: 0, journal: 0 });
      expect(await two!.workspaces()).toContain('local');
    } finally {
      await database.close();
    }
  });
}

for (const [name, open] of [
  ['PGlite', pglite],
  ...(url ? [['a Postgres server', server]] : []),
] as [string, () => Database][])
  describe(`leases on ${name}`, () => {
    beforeEach(() => void (plant = `plant-${crypto.randomUUID()}`));
    leaseCases(open);
  });
