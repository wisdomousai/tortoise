import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { ApplicationError, defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type Effect,
  type EffectOutcome,
} from '@tortoise/runtime';
import {
  DeliveryFailure,
  createEffectDispatcher,
  createInboundSync,
  type SystemOfRecordPort,
} from '../src/index';
import { createLoop } from '../src/loop';

const outcome = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().optional() }),
  z.strictObject({ status: z.literal('rejected'), code: z.string(), message: z.string() }),
]);
const record = defineCapability({
  id: 'reading.record',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), value: z.number() })),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'create', resourceType: 'reading' },
  ui: { exception: 'test fixture' },
  integration: { target: 'erp', delivery: 'outbox' },
});
const complete = defineCapability({
  id: 'reading.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string(), outcome })),
  output: jsonSchema(z.strictObject({ status: z.string() })),
  permission: { action: 'complete', resourceType: 'reading' },
  ui: { exception: 'integration principal' },
});
const sync = defineCapability({
  id: 'catalog.sync',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ from: z.string().optional(), to: z.string(), items: z.array(z.string()) }),
  ),
  output: jsonSchema(z.strictObject({ watermark: z.string() })),
  permission: { action: 'sync', resourceType: 'catalog' },
  ui: { exception: 'integration principal' },
});
type State = {
  readings: Record<string, { value: number; sync: string }>;
  catalog: string[];
  watermark?: string;
};
const operator = { workspaceId: 'w', principalId: 'operator' };
const integration = {
  workspaceId: 'w',
  principalId: 'integration',
  grant: { operations: ['reading.complete', 'catalog.sync'] },
};

function application(options: { failCompletions?: number; now?: () => number } = {}) {
  let failures = options.failCompletions ?? 0;
  let ids = 0;
  const bind = createHandlerFactory<State, {}>();
  const app = createApplication({
    modules: [
      defineModule({
        id: 'readings',
        capabilities: [record, complete, sync],
        requirements: {
          network: [
            {
              id: 'erp-api',
              purpose: 'Test system of record',
              direction: 'outbound',
              scope: 'local',
              protocol: 'https',
              targets: ['erp'],
              dataClasses: ['test-record'],
              availability: 'required',
              offline: 'queue',
            },
          ],
        },
      }),
    ],
    storage: createMemoryStorage<State>({ readings: {}, catalog: [] }),
    services: {},
    newEffectId: () => `e${++ids}`,
    ...(options.now ? { now: options.now } : {}),
    authorization: {
      // The integration principal may only complete and sync; operators may only record.
      authorize: ({ capability, context }) => ({
        allowed:
          context.principalId === 'integration'
            ? capability.id !== 'reading.record'
            : capability.id === 'reading.record',
      }),
      canReadEvent: () => true,
    },
    handlers: [
      bind(record, (input, ctx) => {
        ctx.state.readings[input.id] = { value: input.value, sync: 'pending' };
        ctx.enqueue({
          target: 'erp',
          type: 'reading.post',
          resource: `reading:${input.id}`,
          payload: input,
        });
        ctx.change(`reading:${input.id}`);
        return { id: input.id };
      }),
      bind(complete, (input, ctx) => {
        if (failures-- > 0) throw new ApplicationError('INTERNAL', 'Simulated completion failure');
        const effect = ctx.completeEffect(input.effectId, input.outcome as EffectOutcome);
        ctx.state.readings[effect.resource.slice(8)]!.sync = effect.status;
        ctx.change(effect.resource);
        return { status: effect.status };
      }),
      bind(sync, (input, ctx) => {
        if (input.from !== ctx.state.watermark)
          throw new ApplicationError('CONFLICT', 'Watermark changed');
        ctx.state.catalog.push(...input.items);
        ctx.state.watermark = input.to;
        ctx.change('catalog:watermark');
        return { watermark: input.to };
      }),
    ],
  });
  return app;
}

/** Deterministic target that records each delivery and can deduplicate by effect ID. */
function target(
  options: {
    idempotent?: boolean;
    fail?: (effect: Readonly<Effect>, attempt: number) => Error | undefined;
    reject?: (effect: Readonly<Effect>) => boolean;
  } = {},
) {
  const idempotent = options.idempotent ?? true;
  const records = new Map<string, number>();
  const deliveries: string[] = [];
  const lookups: string[] = [];
  const port: SystemOfRecordPort<string> = {
    describe: () => ({ target: 'erp', idempotentDelivery: idempotent }),
    async deliver(effect) {
      deliveries.push(effect.id);
      const failure = options.fail?.(effect, deliveries.filter((id) => id === effect.id).length);
      if (failure) throw failure;
      if (options.reject?.(effect))
        return { status: 'rejected', code: 'LOT_LOCKED', message: 'Lot is locked' };
      // A non-idempotent target creates a new document for every send.
      if (idempotent) records.set(effect.id, (records.get(effect.id) ?? 0) + 1);
      else records.set(`${effect.id}#${deliveries.length}`, 1);
      return { status: 'accepted', externalRef: `ERP-${effect.id}` };
    },
    async lookup(effectId) {
      lookups.push(effectId);
      return [...records.keys()].some((key) => key.split('#')[0] === effectId)
        ? { status: 'accepted', externalRef: `ERP-${effectId}` }
        : undefined;
    },
  };
  return { port, records, deliveries, lookups };
}

describe('effect dispatcher', () => {
  test('delivers outside the transaction and completes through the domain command', async () => {
    const app = application();
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 4.2 } }, operator);
    const erp = target();
    const dispatcher = createEffectDispatcher({
      application: app,
      port: erp.port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    expect(await dispatcher.runOnce()).toEqual({
      accepted: 1,
      rejected: 0,
      retried: 0,
      deferred: 0,
      held: 0,
      acknowledged: 0,
    });
    expect(erp.deliveries).toEqual(['e1']);
    expect(await app.pendingEffects(integration)).toEqual([]);
    expect(await dispatcher.runOnce()).toEqual({
      accepted: 0,
      rejected: 0,
      retried: 0,
      deferred: 0,
      held: 0,
      acknowledged: 0,
    });
  });

  test('transient failures are recorded with safe text and retried after backoff', async () => {
    let clock = 1_000;
    // Attempt timestamps come from the runtime clock; backoff must compare against the same one.
    const app = application({ now: () => clock });
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 1 } }, operator);
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r2', value: 2 } }, operator);
    const erp = target({
      fail: (effect, attempt) =>
        attempt === 1
          ? effect.id === 'e1'
            ? new DeliveryFailure('Quality system unavailable')
            : new Error('https://erp.example/api?token=secret refused')
          : undefined,
    });
    const dispatcher = createEffectDispatcher({
      application: app,
      port: erp.port,
      context: integration,
      completeOperation: 'reading.complete',
      now: () => clock,
      backoff: () => 5_000,
    });
    expect((await dispatcher.runOnce()).retried).toBe(2);
    const pending = await app.pendingEffects(integration);
    expect(pending.map((effect) => effect.lastFailure)).toEqual([
      'Quality system unavailable',
      'Delivery failed',
    ]);
    expect((await dispatcher.runOnce()).deferred).toBe(2);
    clock += 5_000;
    expect((await dispatcher.runOnce()).accepted).toBe(2);
  });

  test('a target rejection completes as business data instead of retrying', async () => {
    const app = application();
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 1 } }, operator);
    const dispatcher = createEffectDispatcher({
      application: app,
      port: target({ reject: () => true }).port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    expect((await dispatcher.runOnce()).rejected).toBe(1);
    expect(await app.pendingEffects(integration)).toEqual([]);
  });

  test('a failed completion redelivers without duplicating an idempotent target record', async () => {
    const app = application({ failCompletions: 1 });
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 1 } }, operator);
    const erp = target();
    const dispatcher = createEffectDispatcher({
      application: app,
      port: erp.port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    expect((await dispatcher.runOnce()).retried).toBe(1);
    expect((await dispatcher.runOnce(undefined, { ignoreBackoff: true })).accepted).toBe(1);
    expect(erp.deliveries).toEqual(['e1', 'e1']);
    expect(erp.records.get('e1')).toBe(2);
    // The idempotent target deduplicates by effect ID: one external document, delivered twice.
    expect([...erp.records.keys()]).toEqual(['e1']);
  });

  test('a non-idempotent target is looked up before every send', async () => {
    const app = application({ failCompletions: 1 });
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 1 } }, operator);
    const erp = target({ idempotent: false });
    const dispatcher = createEffectDispatcher({
      application: app,
      port: erp.port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    await dispatcher.runOnce();
    await dispatcher.runOnce(undefined, { ignoreBackoff: true });
    expect(erp.lookups).toEqual(['e1', 'e1']);
    expect(erp.deliveries).toEqual(['e1']);
    expect(await app.pendingEffects(integration)).toEqual([]);
    expect(() =>
      createEffectDispatcher({
        application: app,
        port: { ...erp.port, lookup: undefined },
        context: integration,
        completeOperation: 'reading.complete',
      }),
    ).toThrow('needs lookup');
  });

  test('drain reports what remains when the target stays unavailable', async () => {
    const app = application();
    await app.invokeRaw({ operation: 'reading.record', input: { id: 'r1', value: 1 } }, operator);
    const down = createEffectDispatcher({
      application: app,
      port: target({ fail: () => new DeliveryFailure('offline') }).port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    expect(await down.drain(30, 5)).toBe(1);
    const up = createEffectDispatcher({
      application: app,
      port: target().port,
      context: integration,
      completeOperation: 'reading.complete',
    });
    expect(await up.drain(1_000, 5)).toBe(0);
  });

  test('the integration grant cannot call operator commands', async () => {
    const app = application();
    await expect(
      app.invokeRaw({ operation: 'reading.record', input: { id: 'x', value: 1 } }, integration),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('inbound sync', () => {
  test('pulls target pages into watermark-bound sync commands', async () => {
    const app = application();
    let watermark: string | undefined;
    const pages: Record<string, { items: string[]; cursor: string; more: boolean }> = {
      '': { items: ['a', 'b'], cursor: '2', more: true },
      '2': { items: ['c'], cursor: '3', more: false },
      '3': { items: [], cursor: '3', more: false },
    };
    const keys: string[] = [];
    const inbound = createInboundSync<string>({
      application: {
        invokeRaw: async (request, context) => {
          keys.push(request.idempotencyKey!);
          const receipt = await app.invokeRaw(request, context);
          watermark = (receipt.result as { watermark: string }).watermark;
          return receipt;
        },
      },
      port: {
        describe: () => ({ target: 'erp', idempotentDelivery: true }),
        deliver: async () => ({ status: 'accepted' }),
        pull: async (cursor) => pages[cursor ?? '']!,
      },
      context: integration,
      syncOperation: 'catalog.sync',
      readCursor: async () => watermark,
      toInput: (batch) => ({ ...batch, items: [...batch.items] }),
    });
    expect(await inbound.runOnce()).toEqual({ batches: 2, items: 3 });
    expect(keys).toEqual(['sync:catalog.sync::2', 'sync:catalog.sync:2:3']);
    expect(await inbound.runOnce()).toEqual({ batches: 0, items: 0 });
  });
});

describe('background loop', () => {
  test('a stop right after a start returns without waiting out the interval', async () => {
    const loop = createLoop(async () => {
      throw new Error('pass failed');
    });
    loop.start(60_000);
    const started = Date.now();
    await loop.stop();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
