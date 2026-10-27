import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createApplication,
  createMemoryStorage,
  type ExecutionContext,
  type Storage,
} from '@agent-native/runtime';
import { SQLiteStorage } from '../../../packages/adapters/src/sqlite';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from './server';
import type { ServiceState } from './domain';

function fixture(): ServiceState {
  const state = createServiceState();
  state.workOrders.p1 = {
    id: 'p1',
    name: 'Shared',
    closed: false,
    members: { owner: 'dispatcher', technician: 'technician', customer: 'customer' },
  };
  state.workOrders.p2 = {
    id: 'p2',
    name: 'Restricted',
    closed: false,
    members: { owner: 'dispatcher' },
  };
  state.tasks.t1 = {
    id: 't1',
    workOrderId: 'p1',
    title: 'Visible',
    description: 'Public work',
    status: 'todo',
    internalNote: 'SECRET',
  };
  state.tasks.t2 = {
    id: 't2',
    workOrderId: 'p2',
    title: 'Secret task',
    description: 'Confidential',
    status: 'todo',
    internalNote: 'HIDDEN',
  };
  state.tasks.t3 = {
    id: 't3',
    workOrderId: 'p1',
    title: 'Another visible',
    description: '',
    status: 'doing',
  };
  return state;
}
const context = (principalId: string, resources?: string[]): ExecutionContext => ({
  workspaceId: 'w',
  principalId,
  ...(resources
    ? { grant: { operations: ['task.list', 'task.get', 'task.update'], resources } }
    : {}),
});

for (const kind of ['memory', 'sqlite'] as const)
  describe(`${kind} work order/task policy conformance`, () => {
    async function withApp(
      run: (
        app: ReturnType<
          typeof createApplication<ServiceState, {}, readonly [typeof fieldServiceModule]>
        >,
        storage: Storage<ServiceState>,
      ) => Promise<void>,
    ) {
      const directory = await mkdtemp(join(tmpdir(), 'agent-domain-'));
      const storage =
        kind === 'memory'
          ? createMemoryStorage(fixture())
          : new SQLiteStorage(join(directory, 'workspace.sqlite'), fixture);
      const app = createApplication({
        modules: [fieldServiceModule] as const,
        handlers: createServiceHandlers(),
        storage,
        authorization: servicePolicy,
        services: {},
      });
      try {
        await run(app, storage);
      } finally {
        if (storage instanceof SQLiteStorage) await storage.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
    test('scopes rows before page/count/search, work orders output fields and limits grants', async () =>
      withApp(async (app) => {
        const listed = await app.queryRaw(
          { operation: 'task.list', input: { limit: 1 } },
          context('customer'),
        );
        expect(listed.data).toMatchObject({ count: 2, items: [{ id: 't3' }] });
        expect(JSON.stringify(listed)).not.toContain('SECRET');
        expect(JSON.stringify(listed)).not.toContain('HIDDEN');
        const searched = await app.queryRaw(
          { operation: 'task.list', input: { search: 'Confidential' } },
          context('customer'),
        );
        expect(searched.data).toEqual({ count: 0, items: [] });
        const granted = await app.queryRaw(
          { operation: 'task.list', input: {} },
          context('owner', ['task:t1']),
        );
        expect(granted.data).toMatchObject({ count: 1, items: [{ id: 't1' }] });
        await expect(
          app.queryRaw(
            { operation: 'task.get', input: { id: 't2' } },
            context('owner', ['task:t1']),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          app.queryRaw({ operation: 'task.get', input: { id: 't2' } }, context('customer')),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          app.queryRaw(
            { operation: 'task.list', input: { sort: 'internalNote' } },
            context('customer'),
          ),
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        const owner = await app.queryRaw(
          { operation: 'task.get', input: { id: 't1' } },
          context('owner'),
        );
        expect(owner.data).toMatchObject({ internalNote: 'SECRET' });
        const customer = await app.queryRaw(
          { operation: 'work-order.get', input: { id: 'p1' } },
          context('customer'),
        );
        expect(customer.data).not.toHaveProperty('members');
      }));
    test('object and field restrictions protect current and proposed state', async () =>
      withApp(async (app) => {
        await expect(
          app.invokeRaw(
            { operation: 'task.update', input: { id: 't1', title: 'x' } },
            context('customer'),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          app.invokeRaw(
            { operation: 'task.update', input: { id: 't1', internalNote: 'SECRET' } },
            context('technician'),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          app.invokeRaw(
            { operation: 'task.update', input: { id: 't1', workOrderId: 'p2' } },
            context('technician'),
          ),
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        await expect(
          app.invokeRaw(
            {
              operation: 'work-order.set-member',
              input: { id: 'p1', principalId: 'customer', role: 'dispatcher' },
            },
            context('technician'),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const receipt = await app.invokeRaw(
          { operation: 'task.set-status', input: { id: 't1', status: 'doing' } },
          context('technician'),
        );
        expect(receipt.result).not.toHaveProperty('internalNote');
        await app.invokeRaw(
          { operation: 'work-order.close', input: { id: 'p1' } },
          context('owner'),
        );
        await expect(
          app.invokeRaw(
            { operation: 'task.update', input: { id: 't1', title: 'x' } },
            context('technician'),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await app.invokeRaw(
          { operation: 'work-order.reopen', input: { id: 'p1' } },
          context('owner'),
        );
        await app.invokeRaw(
          { operation: 'task.update', input: { id: 't1', title: 'Allowed' } },
          context('technician'),
        );
      }));
    test('conflicts, duplicate retries, revocation, deletion and event replay remain safe', async () =>
      withApp(async (app) => {
        const request = {
          operation: 'task.update',
          input: { id: 't1', title: 'Updated' },
          expectedRevisions: { 'task:t1': 0 },
          idempotencyKey: 'same',
        };
        const duplicates = await Promise.all([
          app.invokeRaw(request, context('technician')),
          app.invokeRaw(request, context('technician')),
        ]);
        expect(duplicates[0]).toEqual(duplicates[1]);
        expect(duplicates[0]?.revisions).toEqual({ 'task:t1': 1 });
        await expect(
          app.invokeRaw({ ...request, idempotencyKey: 'other' }, context('technician')),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(
          app.invokeRaw(
            { ...request, input: { id: 't1', title: 'Different' } },
            context('technician'),
          ),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        const before = await app.events(0, context('technician'));
        expect(before.events).toHaveLength(1);
        await app.invokeRaw(
          {
            operation: 'work-order.set-member',
            input: { id: 'p1', principalId: 'technician', role: null },
          },
          context('owner'),
        );
        const after = await app.events(0, context('technician'));
        expect(after.events).toHaveLength(0);
        expect(after.authorizationRevision).toBeGreaterThan(before.authorizationRevision);
        await expect(app.invokeRaw(request, context('technician'))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        const deleted = await app.invokeRaw(
          { operation: 'task.delete', input: { id: 't1' }, idempotencyKey: 'delete' },
          context('owner'),
        );
        expect(deleted.result).toEqual({ id: 't1' });
        expect(
          (
            await app.invokeRaw(
              { operation: 'task.delete', input: { id: 't1' }, idempotencyKey: 'delete' },
              context('owner'),
            )
          ).result,
        ).toEqual({ id: 't1' });
        expect(
          (await app.events(0, context('customer'))).events.some(
            (event) => event.resource === 'task:t1',
          ),
        ).toBe(true);
      }));
  });
