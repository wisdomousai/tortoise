import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, defineTarget, jsonSchema } from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  definePolicy,
  own,
  put,
} from '@tortoise/runtime';
import {
  connectTarget,
  completeDelivery,
  targetContext,
  targetHandlers,
  targetAllowlist,
  targetRules,
  type Delivered,
  type SystemOfRecordPort,
} from '../src/index';

const erp = defineTarget({
  target: 'erp',
  resourceType: 'ErpSync',
  changes: ['reading'],
  feed: {
    item: z.strictObject({ code: z.string() }),
    max: 10,
    extra: { note: z.string().optional() },
    changes: ['code'],
  },
  status: { pending: z.number().int() },
  descriptions: { complete: 'Complete a reading.', status: 'ERP synchronization.' },
});
const record = defineCapability({
  id: 'reading.record',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), target: z.string().optional() })),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'create', resourceType: 'Reading' },
  ui: { exception: 'test fixture' },
});

type State = {
  integration: string;
  readings: Record<string, Delivered>;
  codes: Record<string, true>;
  note?: string;
  sync: { watermark?: string; lastSyncAt?: number };
};
const operator = { workspaceId: 'w', principalId: 'operator' };
const integration = targetContext(erp, 'w', 'erp-bot');

function setup() {
  let ids = 0;
  const bind = createHandlerFactory<State, {}>();
  const policy = definePolicy<State>({
    integrations: [targetAllowlist(erp, (state, principalId) => principalId === state.integration)],
    operations: { ...targetRules(erp), [record.id]: 'open' },
    events: { reading: () => true, code: () => true, sync: () => true },
  });
  return createApplication({
    modules: [defineModule({ id: 'readings', capabilities: [record, ...erp.capabilities] })],
    storage: createMemoryStorage<State>({
      integration: 'erp-bot',
      readings: {},
      codes: {},
      sync: {},
    }),
    services: {},
    newEffectId: () => `e${++ids}`,
    now: () => 1_000,
    authorization: policy,
    handlers: [
      bind(record, (input, ctx) => {
        const effectId = ctx.enqueue({
          target: input.target ?? 'erp',
          type: 'reading.post',
          resource: `reading:${input.id}`,
          payload: input,
        });
        put(ctx.state.readings, input.id, { effectId, sync: 'pending' });
        ctx.change(`reading:${input.id}`);
        return { id: input.id };
      }),
      ...targetHandlers<State, {}, { code: string }, { note?: string }>(erp, {
        cursor: (state) => state.sync,
        now: () => 2_000,
        onOutcome: (effect, outcome, ctx) =>
          completeDelivery(own(ctx.state.readings, effect.resource.slice(8)), effect, outcome),
        applyBatch(batch, ctx) {
          for (const item of batch.items) put(ctx.state.codes, item.code, true);
          if (batch.note) ctx.state.note = batch.note;
          return batch.items.length;
        },
        status: (ctx) => ({
          pending: ctx.effects({ status: 'pending', target: erp.target }).length,
        }),
      }),
    ],
  });
}

function port(): SystemOfRecordPort<{ code: string }> {
  return {
    describe: () => ({ target: 'erp', idempotentDelivery: true }),
    deliver: async (effect) => ({ status: 'accepted', externalRef: `ERP-${effect.id}` }),
    pull: async (cursor) =>
      cursor === undefined
        ? { items: [{ code: 'A' }, { code: 'B' }], cursor: '1' }
        : { items: [], cursor },
  };
}

describe('defineTarget', () => {
  test('derives operation IDs, the sync resource and the integration grant', () => {
    expect([erp.complete.id, erp.sync.id, erp.status.id]).toEqual([
      'erp.effect.complete',
      'erp.sync',
      'erp.sync.status',
    ]);
    expect(erp.syncResource).toBe('sync:erp');
    expect(integration.grant?.operations).toEqual([
      'erp.effect.complete',
      'erp.sync.status',
      'erp.sync',
    ]);
    expect(erp.complete.ui).toEqual({
      exception: 'integration principal; the outbox dispatcher and inbound sync',
    });
    const outbound = defineTarget({
      target: 'mail',
      resourceType: 'Mail',
      changes: ['message'],
      status: {},
      descriptions: { complete: 'Complete.', status: 'Status.' },
    });
    expect(outbound.sync).toBeUndefined();
    expect(outbound.capabilities.map((capability) => capability.id)).toEqual([
      'mail.effect.complete',
      'mail.sync.status',
    ]);
  });
});

describe('targetHandlers', () => {
  test('connectTarget delivers, completes and pulls under the target principal', async () => {
    const app = setup();
    await app.invokeRaw({ operation: record.id, input: { id: 'r1' } }, operator);
    const connected = connectTarget({
      target: erp,
      application: app,
      port: port(),
      workspaceId: 'w',
      principalId: 'erp-bot',
    });
    expect(await connected.dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    expect(await connected.inbound.runOnce()).toEqual({ batches: 1, items: 2 });
    const status = await app.queryRaw({ operation: erp.status.id, input: {} }, operator);
    expect(status.data).toEqual({ watermark: '1', lastSyncAt: 2_000, pending: 0 });
    const snapshot = await app.queryRaw({ operation: erp.status.id, input: {} }, integration);
    expect(snapshot.data).toMatchObject({ watermark: '1' });
  });

  test('a stale watermark conflicts and side fields reach the batch', async () => {
    const app = setup();
    const sync = (input: Record<string, unknown>) =>
      app.invokeRaw({ operation: erp.sync.id, input }, integration);
    expect((await sync({ to: '1', items: [{ code: 'A' }], note: 'n' })).result).toEqual({
      watermark: '1',
      items: 1,
    });
    await expect(sync({ to: '2', items: [] })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { watermark: '1' },
    });
    await expect(sync({ from: '1', to: '2', items: [] })).resolves.toBeDefined();
  });

  test('complete refuses an effect of another target and an unknown effect', async () => {
    const app = setup();
    await app.invokeRaw({ operation: record.id, input: { id: 'r1', target: 'crm' } }, operator);
    const complete = (effectId: string) =>
      app.invokeRaw(
        { operation: erp.complete.id, input: { effectId, outcome: { status: 'accepted' } } },
        integration,
      );
    await expect(complete('e1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Effect belongs to another integration',
    });
    await expect(complete('e9')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('only the target principal may complete or sync', async () => {
    const app = setup();
    await expect(
      app.invokeRaw({ operation: erp.sync.id, input: { to: '1', items: [] } }, operator),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invokeRaw({ operation: record.id, input: { id: 'r1' } }, integration),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('completeDelivery', () => {
  const effect = { id: 'e1' } as Parameters<typeof completeDelivery>[1];
  test('records the reference or the rejection on the forwarding record', () => {
    const accepted = completeDelivery({ effectId: 'e1', sync: 'pending' }, effect, {
      status: 'accepted',
      externalRef: 'X-1',
    });
    expect(accepted).toEqual({ effectId: 'e1', sync: 'accepted', sorRef: 'X-1' });
    const rejected = completeDelivery({ effectId: 'e1', sync: 'pending' }, effect, {
      status: 'rejected',
      code: 'LOCKED',
      message: 'Locked',
    });
    expect(rejected.rejection).toEqual({ code: 'LOCKED', message: 'Locked' });
  });

  test('a missing record or one that forwarded another effect is NOT_FOUND', () => {
    expect(() => completeDelivery(undefined, effect, { status: 'accepted' })).toThrow(
      'Forwarded record unavailable',
    );
    expect(() =>
      completeDelivery({ effectId: 'e2', sync: 'pending' }, effect, { status: 'accepted' }),
    ).toThrow('Forwarded record unavailable');
  });
});

describe('connectTarget', () => {
  test('a target without a feed only delivers: its inbound side pulls nothing', async () => {
    const outbound = defineTarget({
      target: 'mail',
      resourceType: 'Mail',
      changes: ['message'],
      status: {},
      descriptions: { complete: 'Complete.', status: 'Status.' },
    });
    const mail = connectTarget({
      target: outbound,
      application: setup(),
      port: { ...port(), describe: () => ({ target: 'mail', idempotentDelivery: true }) },
      workspaceId: 'w',
      principalId: 'mail-bot',
    });
    expect(mail.target).toBe('mail');
    expect(await mail.inbound.runOnce()).toEqual({ batches: 0, items: 0 });
    mail.start({ deliverMs: 60_000, syncMs: 60_000 });
    await mail.stop();
  });
});
