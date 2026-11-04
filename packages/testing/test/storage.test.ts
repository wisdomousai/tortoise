import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bunPostgres } from '@tortoise/adapters/postgres-bun';
import { PostgresStorage } from '@tortoise/adapters/postgres-storage';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import { createMemoryStorage } from '@tortoise/runtime';
import { pgliteDriver } from '../src/postgres';
import { storageConformance, type ConformanceState, type StorageHarness } from '../src/storage';

const memory: StorageHarness = {
  async database() {
    let storage: ReturnType<typeof createMemoryStorage<ConformanceState>> | undefined;
    return {
      async open(initial) {
        storage ??= createMemoryStorage<ConformanceState>(() => structuredClone(initial()));
        return Object.assign(Object.create(storage) as typeof storage, { close: async () => {} });
      },
    };
  },
};

const sqlite: StorageHarness = {
  async database() {
    const directory = await mkdtemp(join(tmpdir(), 'storage-conformance-'));
    return {
      open: async (initial) => new SQLiteStorage(join(directory, 'workspace.sqlite'), initial),
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  },
};

const pglite: StorageHarness = {
  async database() {
    const driver = pgliteDriver();
    return {
      open: async (initial) => new PostgresStorage(driver, initial, { scope: 'conformance' }),
      dispose: () => driver.close(),
    };
  },
};

// A real server, only when one is configured: `STORAGE_POSTGRES_URL=postgres://...`. Each case
// gets its own scope, so runs never see each other's rows.
const url = process.env.STORAGE_POSTGRES_URL;
const server: StorageHarness = {
  async database() {
    const driver = bunPostgres(url!);
    const scope = `conformance-${crypto.randomUUID()}`;
    return {
      open: async (initial) => new PostgresStorage(driver, initial, { scope }),
      dispose: () => driver.close(),
    };
  },
};

const adapters: [string, StorageHarness][] = [
  ['memory', memory],
  ['SQLite', sqlite],
  ['Postgres on PGlite', pglite],
  ...(url ? ([['Postgres server', server]] as [string, StorageHarness][]) : []),
];
for (const [name, harness] of adapters)
  describe(`${name} storage`, () => {
    for (const check of storageConformance(harness))
      test(check.name, async () => expect(await check.run()).toEqual({ passed: true }));
  });
