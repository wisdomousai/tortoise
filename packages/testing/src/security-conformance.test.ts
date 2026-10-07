import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import {
  createApplication,
  createMemoryStorage,
  createHandlerFactory,
  type AuthorizationPort,
  type ExecutionContext,
} from '@agent-native/runtime';
import { SQLiteStorage } from '../../adapters/src/sqlite';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
} from '../../../examples/project-tasks/server';

const owner: ExecutionContext = { principalId: 'owner', workspaceId: 'security' };
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
      const initial = createProjectTaskState();
      initial.projects.alpha = {
        id: 'alpha',
        name: 'Visible',
        archived: false,
        members: { delegate: 'owner', observer: 'viewer' },
      };
      initial.projects.beta = { id: 'beta', name: 'Hidden', archived: false, members: {} };
      initial.tasks.visible = {
        id: 'visible',
        projectId: 'alpha',
        title: 'Visible',
        description: '',
        privateNote: 'REPLAY SECRET',
        status: 'todo',
      };
      initial.tasks.hidden = {
        id: 'hidden',
        projectId: 'beta',
        title: 'Hidden',
        description: '',
        status: 'todo',
      };
      const storage =
        kind === 'memory'
          ? createMemoryStorage(initial)
          : new SQLiteStorage(join(directory, 'state.sqlite'), () => initial);
      const app = createApplication({
        modules: [projectTasksModule],
        handlers: createProjectTaskHandlers(),
        storage,
        authorization: projectTaskPolicy,
        services: {},
      });
      try {
        const limited = {
          ...owner,
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
          owner,
        );
        const events = await app.events(0, limited);
        expect(events.events.map((event) => event.resource)).toEqual([
          'task:visible',
          'task:visible',
        ]);
        const delegate = { ...owner, principalId: 'delegate' };
        const replay = {
          operation: 'task.update',
          input: { id: 'visible', title: 'Delegate edit' },
          idempotencyKey: 'projection',
        };
        expect((await app.invokeRaw(replay, delegate)).result).toHaveProperty(
          'privateNote',
          'REPLAY SECRET',
        );
        await app.invokeRaw(
          {
            operation: 'project.set-member',
            input: { id: 'alpha', principalId: 'delegate', role: 'editor' },
          },
          owner,
        );
        expect((await app.invokeRaw(replay, delegate)).result).not.toHaveProperty('privateNote');
        await app.invokeRaw(
          {
            operation: 'project.set-member',
            input: { id: 'alpha', principalId: 'observer', role: null },
          },
          owner,
        );
        expect((await app.events(0, { ...owner, principalId: 'observer' })).events).toEqual([]);
        // Object prototype keys must never become accidental project membership.
        for (const principalId of ['__proto__', 'constructor', 'toString']) {
          expect(
            (await app.queryRaw({ operation: 'task.list', input: {} }, { ...owner, principalId }))
              .data,
          ).toEqual({ items: [], count: 0 });
          await expect(
            app.queryRaw(
              { operation: 'task.get', input: { id: 'visible' } },
              { ...owner, principalId },
            ),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
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
          ...owner,
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
          await storage.read(owner.workspaceId, async (snapshot) => {
            expect(snapshot.state.value).toBe(0);
            expect(snapshot.cursor).toBe(0);
            expect(snapshot.journal).toEqual([]);
            expect(snapshot.receipts).toEqual({});
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
