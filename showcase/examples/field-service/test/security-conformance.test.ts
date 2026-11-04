import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import {
  createApplication,
  createMemoryStorage,
  createHandlerFactory,
  type AuthorizationPort,
  type ExecutionContext,
} from '@tortoise/runtime';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';

const localUser: ExecutionContext = { principalId: 'local-user', workspaceId: 'security' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const kind of ['memory', 'sqlite'] as const)
  describe(`independent ${kind} security verification`, () => {
    test('resource grants constrain rows, replay and event identifiers; role changes reproject stored output', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'security-grants-'));
      const initial = createServiceState();
      initial.workOrders.alpha = {
        id: 'alpha',
        name: 'Visible',
        closed: false,
        members: { delegate: 'dispatcher', observer: 'customer' },
      };
      initial.workOrders.beta = { id: 'beta', name: 'Hidden', closed: false, members: {} };
      initial.tasks.visible = {
        id: 'visible',
        workOrderId: 'alpha',
        title: 'Visible',
        description: '',
        internalNote: 'REPLAY SECRET',
        status: 'todo',
      };
      initial.tasks.hidden = {
        id: 'hidden',
        workOrderId: 'beta',
        title: 'Hidden',
        description: '',
        status: 'todo',
      };
      const storage =
        kind === 'memory'
          ? createMemoryStorage(initial)
          : new SQLiteStorage(join(directory, 'state.sqlite'), () => initial);
      const app = createApplication({
        modules: [fieldServiceModule],
        handlers: createServiceHandlers(),
        storage,
        authorization: servicePolicy,
        services: {},
      });
      try {
        const limited = {
          ...localUser,
          grant: {
            operations: ['task.list', 'task.get', 'task.update'],
            resources: ['task:visible'],
          },
        };
        expect(
          (await app.queryRaw({ operation: 'task.list', input: { limit: 100 } }, limited)).data,
        ).toMatchObject({ count: 1, items: [{ id: 'visible' }] });
        await expect(
          app.queryRaw({ operation: 'task.get', input: { id: 'hidden' } }, limited),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const edit = {
          operation: 'task.update',
          input: { id: 'visible', title: 'Committed' },
          idempotencyKey: 'bound-key',
        };
        await app.invokeRaw(edit, limited);
        await expect(
          app.invokeRaw(edit, {
            ...limited,
            grant: { ...limited.grant, resources: ['task:hidden'] },
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const runBound = {
          operation: 'task.update',
          input: { id: 'visible', title: 'Bound to run' },
          idempotencyKey: 'run-bound',
        };
        await app.invokeRaw(runBound, { ...limited, runId: 'run-a' });
        await expect(app.invokeRaw(runBound, { ...limited, runId: 'run-b' })).rejects.toMatchObject(
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
        await app.invokeRaw(
          { operation: 'task.update', input: { id: 'hidden', title: 'Secret changed' } },
          localUser,
        );
        const events = await app.events(0, limited);
        expect(events.events.map((event) => event.resource)).toEqual([
          'task:visible',
          'task:visible',
        ]);
        const delegate = { ...localUser, principalId: 'delegate' };
        const replay = {
          operation: 'task.update',
          input: { id: 'visible', title: 'Delegate edit' },
          idempotencyKey: 'projection',
        };
        expect((await app.invokeRaw(replay, delegate)).result).toHaveProperty(
          'internalNote',
          'REPLAY SECRET',
        );
        await app.invokeRaw(
          {
            operation: 'work-order.set-member',
            input: { id: 'alpha', principalId: 'delegate', role: 'technician' },
          },
          localUser,
        );
        expect((await app.invokeRaw(replay, delegate)).result).not.toHaveProperty('internalNote');
        await app.invokeRaw(
          {
            operation: 'work-order.set-member',
            input: { id: 'alpha', principalId: 'observer', role: null },
          },
          localUser,
        );
        expect((await app.events(0, { ...localUser, principalId: 'observer' })).events).toEqual([]);
        // Object prototype keys must never become accidental work order membership.
        for (const principalId of ['__proto__', 'constructor', 'toString']) {
          expect(
            (
              await app.queryRaw(
                { operation: 'task.list', input: {} },
                { ...localUser, principalId },
              )
            ).data,
          ).toEqual({ items: [], count: 0 });
          await expect(
            app.queryRaw(
              { operation: 'task.get', input: { id: 'visible' } },
              { ...localUser, principalId },
            ),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
      } finally {
        if (storage instanceof SQLiteStorage) await storage.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
    test('a nested call needs its own grant and policy, commits with its caller and is rechecked at replay', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'security-nested-'));
      const schema = jsonSchema(z.strictObject({ value: z.number().int() }));
      const write = defineCapability({
        id: 'security.write',
        kind: 'command',
        input: schema,
        output: schema,
        permission: { action: 'write', resourceType: 'Counter' },
        ui: { exception: 'security fixture' },
      });
      const batch = defineCapability({
        id: 'security.batch',
        kind: 'command',
        input: schema,
        output: schema,
        permission: { action: 'write', resourceType: 'Counter' },
        ui: { exception: 'security fixture' },
        invokes: ['security.write'],
      });
      let denied: string | undefined;
      const authorization: AuthorizationPort<{ value: number }> = {
        authorize: ({ capability }) => ({ allowed: capability.id !== denied }),
        canReadEvent: () => true,
      };
      const storage =
        kind === 'memory'
          ? createMemoryStorage({ value: 0 })
          : new SQLiteStorage(join(directory, 'state.sqlite'), () => ({ value: 0 }));
      const factory = createHandlerFactory<{ value: number }, {}>();
      const app = createApplication({
        modules: [defineModule({ id: 'security', capabilities: [write, batch] })],
        handlers: [
          factory(write, (input, ctx) => {
            ctx.state.value = input.value;
            ctx.change('counter:one');
            return { value: input.value };
          }),
          factory(batch, async (input, ctx) => {
            const { value } = await ctx.invoke(write, input);
            ctx.change('counter:batch');
            return { value };
          }),
        ],
        storage,
        authorization,
        services: {},
      });
      const request = { operation: batch.id, input: { value: 3 }, idempotencyKey: 'nested' };
      const untouched = () =>
        storage.read(localUser.workspaceId, async (snapshot) => {
          expect(snapshot.state.value).toBe(0);
          expect(snapshot.journal).toEqual([]);
          expect(snapshot.commandResults).toEqual({});
        });
      try {
        await expect(
          app.invokeRaw(request, { ...localUser, grant: { operations: [batch.id] } }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        denied = write.id;
        await expect(app.invokeRaw(request, localUser)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await untouched();
        denied = undefined;
        const first = await app.invokeRaw(request, localUser);
        await storage.read(localUser.workspaceId, async (snapshot) => {
          expect(snapshot.journal.map(({ resource, operation }) => [resource, operation])).toEqual([
            ['counter:batch', 'security.batch'],
            ['counter:one', 'security.write'],
          ]);
          expect(Object.values(snapshot.commandResults)[0]?.calls).toEqual([
            { operation: 'security.write', input: { value: 3 }, via: ['security.batch'] },
          ]);
        });
        expect((await app.invokeRaw(request, localUser)).revisions).toEqual(first.revisions);
        // Losing the nested operation refuses the retry, though the caller's own rule allows it.
        denied = write.id;
        await expect(app.invokeRaw(request, localUser)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      } finally {
        if (storage instanceof SQLiteStorage) await storage.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
    for (const interruption of ['cancel', 'expiry', 'policy'] as const)
      test(`${interruption} during awaited output projection cannot commit or leak a query`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'security-late-'));
        let entered = deferred();
        let release = deferred();
        let time = 0;
        let policyAllowed = true;
        const schema = jsonSchema(z.strictObject({ value: z.number().int() }));
        const write = defineCapability({
          id: 'security.write',
          kind: 'command',
          input: schema,
          output: schema,
          permission: { action: 'write', resourceType: 'Counter' },
          ui: { exception: 'security fixture' },
        });
        const read = defineCapability({
          id: 'security.read',
          kind: 'query',
          input: jsonSchema(z.strictObject({})),
          output: schema,
          permission: { action: 'read', resourceType: 'Counter' },
          ui: { exception: 'security fixture' },
        });
        const authorization: AuthorizationPort<{ value: number }> = {
          authorize: () => ({ allowed: policyAllowed }),
          canReadEvent: () => true,
          async projectOutput({ output }) {
            entered.resolve();
            await release.promise;
            return output;
          },
        };
        const storage =
          kind === 'memory'
            ? createMemoryStorage({ value: 0 })
            : new SQLiteStorage(join(directory, 'state.sqlite'), () => ({ value: 0 }));
        const factory = createHandlerFactory<{ value: number }, {}>();
        const app = createApplication({
          modules: [defineModule({ id: 'security', capabilities: [write, read] })],
          handlers: [
            factory(write, (input, ctx) => {
              ctx.state.value = input.value;
              ctx.change('counter:one');
              return { value: input.value };
            }),
            factory(read, (_, ctx) => ({ value: ctx.state.value })),
          ],
          storage,
          authorization,
          services: {},
          now: () => time,
        });
        const controller = new AbortController();
        const context: ExecutionContext = {
          ...localUser,
          signal: controller.signal,
          grant: { operations: ['security.write', 'security.read'], expiresAt: 5 },
        };
        try {
          const writing = app.invokeRaw(
            { operation: write.id, input: { value: 9 }, idempotencyKey: 'late' },
            context,
          );
          await entered.promise;
          if (interruption === 'cancel') controller.abort();
          else if (interruption === 'expiry') time = 6;
          else policyAllowed = false;
          release.resolve();
          await expect(writing).rejects.toMatchObject({
            code: interruption === 'cancel' ? 'CANCELLED' : 'FORBIDDEN',
          });
          await storage.read(localUser.workspaceId, async (snapshot) => {
            expect(snapshot.state.value).toBe(0);
            expect(snapshot.cursor).toBe(0);
            expect(snapshot.journal).toEqual([]);
            expect(snapshot.commandResults).toEqual({});
          });
          entered = deferred();
          release = deferred();
          time = 0;
          policyAllowed = true;
          const queryController = new AbortController();
          const reading = app.queryRaw(
            { operation: read.id, input: {} },
            { ...context, signal: queryController.signal },
          );
          await entered.promise;
          if (interruption === 'cancel') queryController.abort();
          else if (interruption === 'expiry') time = 6;
          else policyAllowed = false;
          release.resolve();
          await expect(reading).rejects.toMatchObject({
            code: interruption === 'cancel' ? 'CANCELLED' : 'FORBIDDEN',
          });
        } finally {
          release.resolve();
          if (storage instanceof SQLiteStorage) await storage.close();
          await rm(directory, { recursive: true, force: true });
        }
      });
  });
