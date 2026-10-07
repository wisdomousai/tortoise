import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStorage } from './sqlite';

test('snapshot transaction persists journal and receipts together, rolls back, and reads isolate mutation', async () => {
  const path = await mkdtemp(join(tmpdir(), 'agent-storage-'));
  let storage = new SQLiteStorage(join(path, 'workspace.sqlite'), () => ({ count: 0 }));
  try {
    await storage.transact('w', async (snapshot) => {
      snapshot.state.count = 1;
      snapshot.cursor = 1;
      snapshot.journal.push({
        cursor: 1,
        resource: 'task:1',
        revision: 1,
        type: 'changed',
        operation: 'task.update',
      });
      snapshot.receipts.k = {
        fingerprint: 'f',
        principalId: 'owner',
        input: {},
        receipt: {
          operation: 'task.update',
          cursor: 1,
          authorizationRevision: 0,
          revisions: { 'task:1': 1 },
          result: {},
        },
      };
    });
    await expect(
      storage.transact('w', async (snapshot) => {
        snapshot.state.count = 2;
        snapshot.cursor = 2;
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    await storage.close();
    storage = new SQLiteStorage(join(path, 'workspace.sqlite'), () => ({ count: 0 }));
    await storage.read('w', async (snapshot) => {
      expect(snapshot.state.count).toBe(1);
      expect(snapshot.cursor).toBe(1);
      expect(snapshot.journal).toHaveLength(1);
      expect(snapshot.receipts.k?.fingerprint).toBe('f');
      snapshot.state.count = 99;
    });
    await storage.read('w', async (snapshot) => expect(snapshot.state.count).toBe(1));
    await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.transact('w', async (snapshot) => {
          const before = snapshot.state.count;
          await Promise.resolve();
          snapshot.state.count = before + 1;
        }),
      ),
    );
    await storage.read('w', async (snapshot) => expect(snapshot.state.count).toBe(21));
    await storage.read('another-workspace', async (snapshot) =>
      expect(snapshot.state.count).toBe(0),
    );
  } finally {
    await storage.close();
    await rm(path, { recursive: true, force: true });
  }
});

test('JSON snapshot adapter rejects unsupported values instead of silently losing them', async () => {
  const storage = new SQLiteStorage(':memory:', () => ({ data: {} as unknown }));
  try {
    await expect(
      storage.transact('w', async (snapshot) => {
        snapshot.state.data = new Map([['secret', 1]]);
      }),
    ).rejects.toThrow('Non-JSON');
    await storage.read('w', async (snapshot) => expect(snapshot.state.data).toEqual({}));
  } finally {
    await storage.close();
  }
});

test('process death before commit rolls back, and death after commit retains receipt and journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-storage-crash-'));
  const databasePath = join(directory, 'workspace.sqlite');
  const runUntilReady = async (commit: boolean) => {
    const source = `import { SQLiteStorage } from ${JSON.stringify(import.meta.dir + '/sqlite.ts')}; const store = new SQLiteStorage(process.argv[1], () => ({ count: 0 })); ${commit ? 'await' : 'void'} store.transact('w', async s => { s.state.count = 7; s.cursor = 1; s.journal.push({cursor:1,resource:'task:1',revision:1,type:'changed',operation:'task.update'}); s.receipts.key = {fingerprint:'f',principalId:'owner',input:{},receipt:{operation:'task.update',result:{},cursor:1,authorizationRevision:0,revisions:{'task:1':1}}}; ${commit ? '' : "console.log('ready'); await new Promise(() => {});"} }); ${commit ? "console.log('ready');" : ''} setInterval(() => {}, 1000);`;
    const child = Bun.spawn([process.execPath, '-e', source, databasePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const ready = await child.stdout.getReader().read();
      expect(new TextDecoder().decode(ready.value)).toContain('ready');
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  };
  try {
    await runUntilReady(false);
    let storage = new SQLiteStorage(databasePath, () => ({ count: 0 }));
    await storage.read('w', async (s) => {
      expect(s.state.count).toBe(0);
      expect(s.journal).toEqual([]);
      expect(s.receipts).toEqual({});
    });
    await storage.close();
    await runUntilReady(true);
    storage = new SQLiteStorage(databasePath, () => ({ count: 0 }));
    try {
      await storage.read('w', async (s) => {
        expect(s.state.count).toBe(7);
        expect(s.cursor).toBe(1);
        expect(s.journal).toHaveLength(1);
        expect(s.receipts.key?.fingerprint).toBe('f');
      });
    } finally {
      await storage.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
