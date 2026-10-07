import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type AuthorizationPort,
  type HandlerContext,
} from '../src/index';

const add = defineCapability({
  id: 'counter.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ amount: z.number().int() })),
  output: jsonSchema(z.number().int()),
  permission: { action: 'update', resourceType: 'counter' },
  ui: { exception: 'test fixture' },
});
const get = defineCapability({
  id: 'counter.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.number().int()),
  permission: { action: 'read', resourceType: 'counter' },
  ui: { exception: 'test fixture' },
});
const commands = defineModule({ id: 'commands', capabilities: [add] });
const queries = defineModule({ id: 'queries', capabilities: [get], requires: ['commands'] });
type State = { count: number };
const owner = { workspaceId: 'workspace', principalId: 'owner' };
function fixture(
  overrides: {
    handle?: (
      input: { amount: number },
      ctx: HandlerContext<State, {}>,
    ) => number | Promise<number>;
    policy?: AuthorizationPort<State>;
  } = {},
) {
  const storage = createMemoryStorage<State>({ count: 0 });
  const bind = createHandlerFactory<State, {}>();
  const policy: AuthorizationPort<State> = overrides.policy ?? {
    authorize: () => ({ allowed: true }),
    canReadEvent: () => true,
  };
  const app = createApplication({
    modules: [commands, queries],
    storage,
    authorization: policy,
    services: {},
    handlers: [
      bind(
        add,
        overrides.handle ??
          ((input, ctx) => {
            ctx.state.count += input.amount;
            ctx.change('counter:one');
            return ctx.state.count;
          }),
      ),
      bind(get, (_, ctx) => ctx.state.count),
    ],
  });
  return { app, storage };
}
describe('authorized atomic command runtime', () => {
  test('two modules preserve command/query literals and inferred results', async () => {
    const { app } = fixture();
    const receipt = await app.invoke({ operation: 'counter.add', input: { amount: 2 } }, owner);
    const result: number = receipt.result;
    expect(result).toBe(2);
    expect(await app.query({ operation: 'counter.get', input: {} }, owner)).toEqual({
      data: 2,
      cursor: 1,
      authorizationRevision: 0,
    });
    if (false) {
      // @ts-expect-error unknown operation
      void app.invoke({ operation: 'missing', input: {} }, owner);
      // @ts-expect-error command arguments are inferred
      void app.invoke({ operation: 'counter.add', input: { amount: '2' } }, owner);
      // @ts-expect-error queries cannot run on the command path
      void app.invoke({ operation: 'counter.get', input: {} }, owner);
      // @ts-expect-error handler output must match the capability
      createHandlerFactory<State, {}>()(add, () => 'invalid');
    }
  });
  test('output schema failures roll back data, receipt and journal together', async () => {
    const { app, storage } = fixture({
      handle: (input, ctx) => {
        ctx.state.count += input.amount;
        ctx.change('counter:one');
        return 'invalid' as unknown as number;
      },
    });
    await expect(
      app.invoke({ operation: 'counter.add', input: { amount: 2 }, idempotencyKey: 'bad' }, owner),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(await storage.read(owner.workspaceId, async (snapshot) => snapshot)).toMatchObject({
      state: { count: 0 },
      cursor: 0,
      journal: [],
      receipts: {},
    });
  });
  test('commit authorization and cancellation are rechecked after handler work', async () => {
    let allowed = true;
    const policy: AuthorizationPort<State> = {
      authorize: () => ({ allowed }),
      canReadEvent: () => allowed,
    };
    const { app } = fixture({
      policy,
      handle: (_, ctx) => {
        ctx.state.count++;
        ctx.change('counter:one');
        allowed = false;
        return ctx.state.count;
      },
    });
    await expect(
      app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    allowed = true;
    expect((await app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(0);
    const controller = new AbortController();
    const cancelled = fixture({
      handle: (_, ctx) => {
        ctx.state.count++;
        ctx.change('counter:one');
        controller.abort();
        return ctx.state.count;
      },
    });
    await expect(
      cancelled.app.invoke(
        { operation: 'counter.add', input: { amount: 1 } },
        { ...owner, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect((await cancelled.app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(
      0,
    );
  });
  test('canonical idempotency is scoped and current authorization governs retries', async () => {
    let allowed = true;
    const { app } = fixture({
      policy: { authorize: () => ({ allowed }), canReadEvent: () => allowed },
    });
    const request = {
      operation: 'counter.add' as const,
      input: { amount: 1 },
      idempotencyKey: 'retry',
    };
    const first = await app.invoke(request, owner);
    expect(await app.invoke(request, owner)).toEqual(first);
    await expect(app.invoke({ ...request, input: { amount: 2 } }, owner)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect((await app.invoke(request, { ...owner, principalId: 'another' })).result).toBe(2);
    allowed = false;
    await expect(app.invoke(request, owner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await app.events(0, owner)).toEqual({ events: [], cursor: 2, authorizationRevision: 0 });
  });
  test('concurrent expected-revision commands cannot lose updates', async () => {
    const { app } = fixture();
    const request = {
      operation: 'counter.add' as const,
      input: { amount: 1 },
      expectedRevisions: { 'counter:one': 0 },
    };
    const results = await Promise.allSettled([
      app.invoke(request, owner),
      app.invoke(request, owner),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(1);
  });
  test('expected revisions of unreadable resources are denied before any comparison', async () => {
    const { app } = fixture({
      policy: {
        authorize: () => ({ allowed: true }),
        canReadEvent: ({ event }) => event.resource === 'counter:one',
      },
    });
    await app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner);
    const probe = (expectedRevisions: Record<string, number>) =>
      app.invoke({ operation: 'counter.add', input: { amount: 1 }, expectedRevisions }, owner);
    // Hidden and nonexistent keys at any revision fail the same way, so no revision leaks.
    for (const revisions of <Record<string, number>[]>[
      { 'counter:hidden': 0 },
      { 'counter:hidden': 1 },
      { 'counter:missing': 0 },
      { 'counter:one': 0, 'counter:hidden': 0 },
    ])
      await expect(probe(revisions)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(probe({ 'counter:one': 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await probe({ 'counter:one': 1 })).result).toBe(2);
    const granted = {
      ...owner,
      grant: { operations: ['counter.add'], resources: ['counter:two'] },
    };
    await expect(
      app.invoke(
        { operation: 'counter.add', input: { amount: 1 }, expectedRevisions: { 'counter:one': 1 } },
        granted,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  test('idempotency fingerprints bind application version, run and effective grant context', async () => {
    const { app, storage } = fixture();
    const request = {
      operation: 'counter.add' as const,
      input: { amount: 1 },
      idempotencyKey: 'bound',
    };
    await app.invoke(request, { ...owner, runId: 'run-a' });
    await expect(app.invoke(request, { ...owner, runId: 'run-b' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(
      app.invoke(request, { ...owner, runId: 'run-a', grant: { operations: ['counter.add'] } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const bind = createHandlerFactory<State, {}>();
    const upgraded = createApplication({
      contractVersion: '2.0.0',
      modules: [commands, queries],
      storage,
      services: {},
      authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      handlers: [bind(add, (_, ctx) => ctx.state.count), bind(get, (_, ctx) => ctx.state.count)],
    });
    await expect(upgraded.invoke(request, { ...owner, runId: 'run-a' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  test('grants and projection apply before commits and event delivery', async () => {
    const { app } = fixture({
      policy: {
        authorize: () => ({ allowed: true }),
        projectOutput: ({ output }) => output,
        canReadEvent: () => true,
      },
    });
    await expect(
      app.invoke(
        { operation: 'counter.add', input: { amount: 1 } },
        { ...owner, grant: { operations: [] } },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invoke(
        { operation: 'counter.add', input: { amount: 1 } },
        { ...owner, grant: { operations: ['counter.add'], resources: ['counter:other'] } },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner);
    expect((await app.events(0, { ...owner, grant: { operations: [] } })).events).toEqual([]);
    expect((await app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(1);
  });
  test('authorization revision commits with policy-changing state', async () => {
    const { app } = fixture({
      handle: (_, ctx) => {
        ctx.state.count++;
        ctx.invalidateAuthorization();
        ctx.change('counter:one');
        return ctx.state.count;
      },
    });
    expect(
      (await app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner))
        .authorizationRevision,
    ).toBe(1);
    expect((await app.events(0, owner)).authorizationRevision).toBe(1);
  });
  test('queries cannot mutate authoritative state', async () => {
    const storage = createMemoryStorage({ count: 0 });
    const bind = createHandlerFactory<State, {}>();
    const app = createApplication({
      modules: [commands, queries],
      storage,
      services: {},
      authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      handlers: [bind(add, (_, ctx) => ctx.state.count), bind(get, (_, ctx) => ++ctx.state.count)],
    });
    await expect(app.query({ operation: 'counter.get', input: {} }, owner)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(await storage.read(owner.workspaceId, async (snapshot) => snapshot.state.count)).toBe(0);
  });
  test('feature state may use cloneable repository structures rather than JSON records', async () => {
    const storage = createMemoryStorage({ counts: new Map([['one', 3]]) });
    const bind = createHandlerFactory<{ counts: Map<string, number> }, {}>();
    const app = createApplication({
      modules: [defineModule({ id: 'queries', capabilities: [get] })],
      storage,
      services: {},
      authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
      handlers: [bind(get, (_, ctx) => ctx.state.counts.get('one')!)],
    });
    expect((await app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(3);
  });
  test('undeclared changes cannot commit without reactive journal information', async () => {
    const { app } = fixture({ handle: (_, ctx) => ++ctx.state.count });
    await expect(
      app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect((await app.query({ operation: 'counter.get', input: {} }, owner)).data).toBe(0);
  });
  test('grant bindings are enforced on command, event and discovery surfaces', async () => {
    const { app } = fixture();
    const context = { ...owner, grant: { operations: ['counter.add'], workspaceId: 'different' } };
    await expect(
      app.invoke({ operation: 'counter.add', input: { amount: 1 } }, context),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.events(0, context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(() => app.discover(context)).toThrow();
  });
  test('invalid authorized projections roll back instead of returning malformed DTOs', async () => {
    const { app } = fixture({
      policy: {
        authorize: () => ({ allowed: true }),
        projectOutput: () => null,
        canReadEvent: () => true,
      },
    });
    await expect(
      app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
  test('synchronous event delivery remains inside the boundary excluding queued revocation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const order: string[] = [];
    const { app } = fixture({
      policy: {
        authorize: () => ({ allowed: true }),
        canReadEvent: async ({ state }) => {
          started();
          await gate;
          return state.count > 0;
        },
      },
    });
    await app.invoke({ operation: 'counter.add', input: { amount: 1 } }, owner);
    const delivery = app.deliverEvents(0, owner, (batch) => {
      expect(batch.events).toHaveLength(1);
      order.push('delivered');
    });
    await reading;
    const revoke = app
      .invoke({ operation: 'counter.add', input: { amount: -1 } }, owner)
      .then(() => {
        order.push('revoked');
      });
    release();
    await Promise.all([delivery, revoke]);
    expect(order).toEqual(['delivered', 'revoked']);
    expect((await app.events(0, owner)).events).toEqual([]);
  });
});
