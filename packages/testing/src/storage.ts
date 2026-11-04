import type { Storage, StoredReceipt } from '@tortoise/runtime';
import type { ConformanceCase } from './connectors';

/** The state every storage case works on. */
export interface ConformanceState {
  count: number;
  items: Record<string, { text: string }>;
}
export type ConformanceStorage = Storage<ConformanceState> & { close(): Promise<void> };

/**
 * A storage adapter under test. `database` starts an empty backing store; each `open` on it
 * returns a storage over the same data, so a second `open` after `close` shows what a restart
 * sees. A storage kept only in memory may return the same instance again.
 */
export interface StorageHarness {
  database(): Promise<{
    open(initial: () => ConformanceState): Promise<ConformanceStorage>;
    dispose?(): Promise<void>;
  }>;
}

const fresh = (): ConformanceState => ({ count: 0, items: {} });
const receipt = (cursor: number): StoredReceipt => ({
  fingerprint: `f${cursor}`,
  principalId: 'owner',
  input: {},
  receipt: {
    operation: 'item.put',
    cursor,
    authorizationRevision: 0,
    revisions: { [`item:${cursor}`]: cursor },
    result: {},
  },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * The guarantees the kernel relies on from any `Storage`, as cases a test runs against an
 * adapter. Each case opens a fresh database. Failures throw with what was observed.
 */
export function storageConformance(harness: StorageHarness): ConformanceCase[] {
  const run =
    (
      body: (
        open: (initial?: () => ConformanceState) => Promise<ConformanceStorage>,
      ) => Promise<void>,
    ) =>
    async () => {
      const database = await harness.database();
      const opened: ConformanceStorage[] = [];
      try {
        await body(async (initial = fresh) => {
          const storage = await database.open(initial);
          opened.push(storage);
          return storage;
        });
      } finally {
        for (const storage of opened) await storage.close().catch(() => undefined);
        await database.dispose?.();
      }
      return { passed: true } as const;
    };
  return [
    {
      name: 'a commit stores state, journal, revisions and receipts together, and a reopen sees them',
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('w', async (snapshot) => {
          snapshot.state.count = 1;
          snapshot.state.items.a = { text: 'a' };
          snapshot.cursor = 1;
          snapshot.resourceRevisions['item:a'] = 1;
          snapshot.journal.push({
            cursor: 1,
            resource: 'item:a',
            revision: 1,
            type: 'changed',
            operation: 'item.put',
          });
          snapshot.receipts.k1 = receipt(1);
        });
        await storage.close();
        await (
          await open()
        ).read('w', async (snapshot) => {
          assert(snapshot.state.count === 1, `count is ${snapshot.state.count} after a reopen`);
          assert(snapshot.state.items.a?.text === 'a', 'the item is missing after a reopen');
          assert(snapshot.cursor === 1, `cursor is ${snapshot.cursor}`);
          assert(snapshot.resourceRevisions['item:a'] === 1, 'the revision is missing');
          assert(
            snapshot.journal.length === 1 && snapshot.journal[0]!.cursor === 1,
            'the journal entry is missing',
          );
          assert(snapshot.receipts.k1?.fingerprint === 'f1', 'the receipt is missing');
        });
      }),
    },
    {
      name: 'a transaction that throws commits nothing',
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('w', async (snapshot) => {
          snapshot.state.count = 1;
        });
        let thrown: unknown;
        try {
          await storage.transact('w', async (snapshot) => {
            snapshot.state.count = 2;
            snapshot.state.items.b = { text: 'b' };
            snapshot.cursor = 2;
            snapshot.receipts.k2 = receipt(2);
            throw new Error('fail');
          });
        } catch (error) {
          thrown = error;
        }
        assert((thrown as Error)?.message === 'fail', 'the callback error was not passed on');
        const check = (storage: ConformanceStorage) =>
          storage.read('w', async (snapshot) => {
            assert(snapshot.state.count === 1, `count is ${snapshot.state.count} after a rollback`);
            assert(
              !snapshot.state.items.b && !snapshot.receipts.k2 && snapshot.cursor === 0,
              'a rolled-back write is visible',
            );
          });
        await check(storage);
        await storage.close();
        await check(await open());
      }),
    },
    {
      name: "a reader's mutation never reaches the next caller",
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('w', async (snapshot) => {
          snapshot.state.count = 1;
        });
        await storage.read('w', async (snapshot) => {
          (snapshot.state as ConformanceState).count = 99;
          (snapshot.state as ConformanceState).items.x = { text: 'x' };
        });
        await storage.read('w', async (snapshot) =>
          assert(
            snapshot.state.count === 1 && !snapshot.state.items.x,
            'a read saw a reader’s mutation',
          ),
        );
        await storage.transact('w', async (snapshot) =>
          assert(snapshot.state.count === 1, 'a transaction saw a reader’s mutation'),
        );
      }),
    },
    {
      name: "the initial state factory's object is never handed to a transaction",
      run: run(async (open) => {
        const shared = fresh();
        const storage = await open(() => shared);
        try {
          await storage.transact('w', async (snapshot) => {
            snapshot.state.count = 5;
            throw new Error('fail');
          });
        } catch {
          // Expected.
        }
        assert(shared.count === 0, 'the factory result was mutated');
        await storage.read('w', async (snapshot) =>
          assert(snapshot.state.count === 0, `a new workspace starts at ${snapshot.state.count}`),
        );
      }),
    },
    {
      name: 'concurrent transactions on one workspace run one after another',
      run: run(async (open) => {
        const storage = await open();
        await Promise.all(
          Array.from({ length: 20 }, () =>
            storage.transact('w', async (snapshot) => {
              const before = snapshot.state.count;
              await Promise.resolve();
              snapshot.state.count = before + 1;
            }),
          ),
        );
        await storage.read('w', async (snapshot) =>
          assert(snapshot.state.count === 20, `20 increments stored ${snapshot.state.count}`),
        );
      }),
    },
    {
      name: 'workspaces are independent',
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('a', async (snapshot) => {
          snapshot.state.count = 1;
        });
        await storage.read('b', async (snapshot) =>
          assert(snapshot.state.count === 0, 'another workspace saw the commit'),
        );
      }),
    },
    {
      name: 'a removed record stays removed, and a stored __proto__ key stays data',
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('w', async (snapshot) => {
          snapshot.state.items.a = { text: 'a' };
          snapshot.state.items.b = { text: 'b' };
          Object.defineProperty(snapshot.state.items, '__proto__', {
            value: { text: 'polluted' },
            enumerable: true,
            writable: true,
            configurable: true,
          });
        });
        await storage.transact('w', async (snapshot) => {
          delete snapshot.state.items.a;
        });
        await storage.close();
        await (
          await open()
        ).read('w', async (snapshot) => {
          const { items } = snapshot.state;
          assert(
            !Object.hasOwn(items, 'a') && items.b?.text === 'b',
            'the removed record came back',
          );
          assert(Object.hasOwn(items, '__proto__'), 'the __proto__ record was lost');
          assert(
            Object.getPrototypeOf(items) === Object.prototype ||
              Object.getPrototypeOf(items) === null,
            'the prototype changed',
          );
          assert(({} as { text?: string }).text === undefined, 'Object.prototype was polluted');
        });
      }),
    },
    {
      name: 'outbox effects and blob references are stored with the commit',
      run: run(async (open) => {
        const storage = await open();
        await storage.transact('w', async (snapshot) => {
          snapshot.effects.e1 = {
            id: 'e1',
            operation: 'item.put',
            principalId: 'owner',
            resource: 'item:a',
            target: 'erp',
            type: 'item.created',
            payload: { id: 'a' },
            createdAt: 1,
            status: 'pending',
            attempts: 0,
          };
          snapshot.blobs['sha256:00'] = { size: 1, mediaType: 'text/plain', resources: ['item:a'] };
        });
        await storage.close();
        await (
          await open()
        ).read('w', async (snapshot) => {
          assert(snapshot.effects.e1?.status === 'pending', 'the effect is missing');
          assert(
            snapshot.blobs['sha256:00']?.resources[0] === 'item:a',
            'the blob reference is missing',
          );
        });
      }),
    },
  ];
}
