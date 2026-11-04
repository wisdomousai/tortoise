import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { createApplication, type Storage } from '@tortoise/runtime';
import { SnapshotStorage } from './snapshot-storage';
import { SQLiteStorage, bunSqlDriver } from './sqlite';
import { restoreBackup, verifyBackup } from './workspace-backup';

interface Item {
  readonly id: string;
  readonly text: string;
}
type State = { items: { byId: Record<string, Item> } };
const initial = (): State => ({ items: { byId: {} } });

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-row-storage-'));
  return { directory, path: join(directory, 'workspace.sqlite') };
}

const put = defineCapability({
  id: 'item.put',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), text: z.string() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Item' },
  ui: { exception: 'test fixture' },
});
function application(storage: Storage<State>) {
  return createApplication({
    modules: [defineModule({ id: 'items', capabilities: [put] })],
    storage,
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      {
        capability: put,
        handle(input, ctx) {
          const { id, text } = input as Item;
          (ctx.state as State).items.byId[id] = { id, text };
          ctx.change(`item:${id}`);
          return {};
        },
      },
    ],
  });
}
const owner = { workspaceId: 'w', principalId: 'owner' };
const putItem = (
  app: ReturnType<typeof application>,
  id: string,
  text = id,
  key = `${id}:${text}`,
) => app.invokeRaw({ operation: 'item.put', input: { id, text }, idempotencyKey: key }, owner);

test('a commit writes the changed record and its bookkeeping, not the whole workspace', async () => {
  const { directory, path } = await scratch();
  const storage = new SQLiteStorage(path, initial);
  try {
    await storage.transact('w', async (snapshot) => {
      for (let i = 0; i < 1_000; i++)
        snapshot.state.items.byId[`i${i}`] = { id: `i${i}`, text: '' };
    });
    expect(storage.lastWrite.rows).toBe(1_000);
    const app = application(storage);
    await putItem(app, 'i500', 'changed');
    // The record, its revision and the receipt; the journal entry is counted apart.
    expect(storage.lastWrite).toEqual({ rows: 3, deletes: 0, journal: 1 });
    await storage.transact('w', async (snapshot) => {
      delete snapshot.state.items.byId.i1;
    });
    expect(storage.lastWrite).toEqual({ rows: 0, deletes: 1, journal: 0 });
    await storage.close();
    const reopened = new SQLiteStorage(path, initial);
    await reopened.read('w', async ({ state }) => {
      expect(Object.keys(state.items.byId)).toHaveLength(999);
      expect(state.items.byId.i500?.text).toBe('changed');
    });
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the cached snapshot is never reused after a failed transaction or another connection', async () => {
  const { directory, path } = await scratch();
  const first = new SQLiteStorage(path, initial);
  const second = new SQLiteStorage(path, initial);
  try {
    await putItem(application(first), 'a', 'one');
    await expect(
      first.transact('w', async (snapshot) => {
        snapshot.state.items.byId.a = { id: 'a', text: 'rolled back' };
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await first.read('w', async ({ state }) => expect(state.items.byId.a?.text).toBe('one'));
    await putItem(application(second), 'a', 'two');
    await first.read('w', async ({ state }) => expect(state.items.byId.a?.text).toBe('two'));
    await first.transact('w', async (snapshot) => {
      expect(snapshot.cursor).toBe(2);
    });
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a stored __proto__ key stays an ordinary record', async () => {
  const storage = new SQLiteStorage<Record<string, unknown>>(':memory:', () => ({}));
  try {
    await storage.transact('w', async (snapshot) => {
      snapshot.state = JSON.parse('{"__proto__":{"polluted":true},"plain":1}');
    });
    await storage.read('w', async ({ state }) => {
      expect(Object.hasOwn(state, '__proto__')).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(state.plain).toBe(1);
    });
  } finally {
    await storage.close();
  }
});

test('journal retention drops old entries, and a cursor behind them gets a reset', async () => {
  const storage = new SQLiteStorage(':memory:', initial, {
    retention: { journal: 3, receipts: 2 },
  });
  try {
    const app = application(storage);
    for (let i = 1; i <= 6; i++) await putItem(app, `i${i}`);
    await storage.read('w', async (snapshot) => {
      expect(snapshot.journal.map((entry) => entry.cursor)).toEqual([4, 5, 6]);
      expect(snapshot.journalFloor).toBe(3);
      expect(Object.keys(snapshot.receipts)).toHaveLength(2);
    });
    const behind = await app.events(1, owner);
    expect(behind).toMatchObject({ events: [], cursor: 6, reset: true });
    const current = await app.events(3, owner);
    expect(current.reset).toBeUndefined();
    expect(current.events.map((event) => event.cursor)).toEqual([4, 5, 6]);
    // The oldest receipt is gone, so that retry runs again; a kept one replays.
    const replay = await putItem(app, 'i6');
    expect(replay.cursor).toBe(6);
    expect((await putItem(app, 'i1')).cursor).toBe(7);
  } finally {
    await storage.close();
  }
});

test('a file from an older schema version is refused, and each format refuses the other', async () => {
  const { directory, path } = await scratch();
  try {
    for (const version of [1, 2]) {
      const older = join(directory, `version-${version}.sqlite`);
      const db = new Database(older, { create: true });
      db.exec(`CREATE TABLE framework_schema (version INTEGER NOT NULL);
        INSERT INTO framework_schema VALUES (${version});`);
      db.close();
      expect(() => new SQLiteStorage(older, initial)).toThrow(
        `Unsupported storage schema version ${version}: version 3 renamed stored fields`,
      );
      expect(() => new SnapshotStorage(bunSqlDriver(older), initial)).toThrow(
        'renamed stored fields',
      );
    }
    const snapshots = new SnapshotStorage(bunSqlDriver(path), initial);
    await putItem(application(snapshots), 'a', 'kept');
    await snapshots.close();
    expect(() => new SQLiteStorage(path, initial)).toThrow('holds snapshot storage');
    const rows = join(directory, 'rows.sqlite');
    await new SQLiteStorage(rows, initial).close();
    expect(() => new SnapshotStorage(bunSqlDriver(rows), initial)).toThrow('holds row storage');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an online backup verifies and restores, and a damaged one is refused', async () => {
  const { directory, path } = await scratch();
  const backup = join(directory, 'backup.sqlite');
  try {
    const storage = new SQLiteStorage(path, initial);
    const app = application(storage);
    await putItem(app, 'a', 'before');
    await storage.backup(backup);
    await putItem(app, 'a', 'after');
    await storage.close();
    expect(verifyBackup(backup)).toEqual({ schemaVersion: 3, workspaces: 1 });
    expect(await restoreBackup(backup, path)).toEqual({ schemaVersion: 3, workspaces: 1 });
    const restored = new SQLiteStorage(path, initial);
    await restored.read('w', async ({ state }) => expect(state.items.byId.a?.text).toBe('before'));
    await restored.close();
    const damaged = join(directory, 'damaged.sqlite');
    await writeFile(damaged, 'not a database');
    expect(() => verifyBackup(damaged)).toThrow();
    const foreign = join(directory, 'foreign.sqlite');
    new Database(foreign, { create: true }).close();
    expect(() => verifyBackup(foreign)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark: one-record commits on a large workspace, rows against one document', async () => {
  const { directory } = await scratch();
  const seed = (snapshot: { state: State }) => {
    for (let i = 0; i < 20_000; i++)
      snapshot.state.items.byId[`i${i}`] = { id: `i${i}`, text: 'x'.repeat(200) };
  };
  const measure = async (storage: Storage<State> & { close(): Promise<void> }) => {
    await storage.transact('w', async (snapshot) => seed(snapshot));
    const app = application(storage);
    const started = performance.now();
    for (let i = 0; i < 20; i++) await putItem(app, `i${i}`, `changed ${i}`);
    const perCommit = (performance.now() - started) / 20;
    await storage.close();
    return perCommit;
  };
  try {
    const rows = await measure(new SQLiteStorage(join(directory, 'rows.sqlite'), initial));
    const document = await measure(
      new SnapshotStorage(bunSqlDriver(join(directory, 'document.sqlite')), initial),
    );
    console.log(
      `20,000 records (~5 MB): rows ${rows.toFixed(1)} ms/commit, document ${document.toFixed(1)} ms/commit`,
    );
    expect(rows).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
