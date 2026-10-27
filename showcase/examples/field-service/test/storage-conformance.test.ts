import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication, createMemoryStorage, type Storage } from '@agent-native/runtime';
import { errorEnvelope } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';
import type { ServiceState } from '../domain';
import { assertEquivalent, directDriver, type ScenarioDriver } from '@agent-native/testing';

async function scenario(driver: ScenarioDriver) {
  const owner = { workspaceId: 'conformance', principalId: 'owner' };
  const technician = { ...owner, principalId: 'technician' };
  const outcomes: unknown[] = [];
  outcomes.push(
    await driver.command(
      {
        operation: 'work-order.create',
        input: { name: 'Independent' },
        idempotencyKey: 'work-order',
      },
      owner,
    ),
  );
  outcomes.push(
    await driver.command(
      {
        operation: 'work-order.set-member',
        input: { id: 'id-1', principalId: 'technician', role: 'technician' },
        idempotencyKey: 'membership',
      },
      owner,
    ),
  );
  outcomes.push(
    await driver.command(
      {
        operation: 'task.create',
        input: { workOrderId: 'id-1', title: 'Shared', internalNote: 'hidden' },
        idempotencyKey: 'task',
      },
      owner,
    ),
  );
  outcomes.push(await driver.query({ operation: 'task.list', input: {} }, technician));
  const edit = {
    operation: 'task.update',
    input: { id: 'id-2', title: 'Committed' },
    expectedRevisions: { 'task:id-2': 1 },
    idempotencyKey: 'edit',
  };
  outcomes.push(await driver.command(edit, technician));
  outcomes.push(await driver.command(edit, technician));
  outcomes.push(
    await driver.command(
      {
        operation: 'work-order.set-member',
        input: { id: 'id-1', principalId: 'technician', role: null },
        idempotencyKey: 'revoke',
      },
      owner,
    ),
  );
  try {
    await driver.command(edit, technician);
    throw new Error('Revoked replay unexpectedly succeeded');
  } catch (error) {
    outcomes.push(errorEnvelope(error));
  }
  outcomes.push(await driver.query({ operation: 'task.list', input: {} }, technician));
  return outcomes;
}

test('independent work order workflow has identical memory and SQLite outcomes after revocation and retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-storage-conformance-'));
  const durable = new SQLiteStorage(join(directory, 'workspace.sqlite'), createServiceState);
  try {
    const run = async (storage: Storage<ServiceState>) => {
      let id = 0;
      const app = createApplication({
        modules: [fieldServiceModule],
        handlers: createServiceHandlers(),
        storage,
        authorization: servicePolicy,
        services: { newId: () => `id-${++id}` },
      });
      const outcomes = await scenario(directDriver(app));
      expect(JSON.stringify(outcomes[3])).not.toContain('hidden');
      expect(outcomes[7]).toMatchObject({ code: 'FORBIDDEN' });
      expect(
        (await app.events(0, { workspaceId: 'conformance', principalId: 'technician' })).events,
      ).toEqual([]);
      return outcomes;
    };
    assertEquivalent(await run(createMemoryStorage(createServiceState())), await run(durable));
  } finally {
    await durable.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('memory and SQLite commit outbox effects atomically and load pre-outbox documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-outbox-conformance-'));
  const path = join(directory, 'workspace.sqlite');
  // A document persisted before the outbox existed has no effects field.
  const legacy = new Database(path, { create: true });
  legacy.exec(
    'CREATE TABLE framework_schema (version INTEGER NOT NULL); INSERT INTO framework_schema VALUES (1); CREATE TABLE workspace_snapshots (workspace_id TEXT PRIMARY KEY, document TEXT NOT NULL)',
  );
  legacy.query('INSERT INTO workspace_snapshots VALUES (?, ?)').run(
    'w',
    JSON.stringify({
      state: { n: 0 },
      cursor: 0,
      authorizationRevision: 0,
      resourceRevisions: {},
      receipts: {},
      journal: [],
    }),
  );
  legacy.close();
  const durable = new SQLiteStorage<{ n: number }>(path, () => ({ n: 0 }));
  try {
    for (const storage of [createMemoryStorage({ n: 0 }), durable] as Storage<{ n: number }>[]) {
      expect(await storage.read('w', async (snapshot) => snapshot.effects)).toEqual({});
      await expect(
        storage.transact('w', async (snapshot) => {
          snapshot.effects.e1 = {
            id: 'e1',
            target: 'sor',
            type: 't',
            resource: 'r:1',
            payload: {},
            operation: 'op',
            principalId: 'p',
            createdAt: 1,
            status: 'pending',
            attempts: 0,
          };
          throw new Error('rejected work');
        }),
      ).rejects.toThrow('rejected work');
      expect(await storage.read('w', async (snapshot) => snapshot.effects)).toEqual({});
      await storage.transact('w', async (snapshot) => {
        snapshot.state.n = 1;
        snapshot.effects.e2 = {
          id: 'e2',
          target: 'sor',
          type: 't',
          resource: 'r:1',
          payload: { v: 1 },
          operation: 'op',
          principalId: 'p',
          createdAt: 2,
          status: 'pending',
          attempts: 0,
        };
      });
      expect(
        await storage.read('w', async (snapshot) => [
          snapshot.state.n,
          Object.keys(snapshot.effects),
        ]),
      ).toEqual([1, ['e2']]);
    }
  } finally {
    await durable.close();
    await rm(directory, { recursive: true, force: true });
  }
});
