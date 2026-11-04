import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type Effect,
  type EffectOutcome,
} from '@tortoise/runtime';
import {
  DeliveryUncertain,
  createEffectDispatcher,
  drainTargets,
  type LookupResult,
  type SystemOfRecordPort,
} from '../src/index';

const outcome = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().optional() }),
  z.strictObject({ status: z.literal('rejected'), code: z.string(), message: z.string() }),
]);
const load = defineCapability({
  id: 'recipe.load',
  kind: 'command',
  input: jsonSchema(z.strictObject({ recipe: z.string() })),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'load', resourceType: 'station' },
  ui: { exception: 'test fixture' },
  integration: { target: 'legacy-hmi', delivery: 'outbox' },
});
const complete = defineCapability({
  id: 'recipe.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string(), outcome })),
  output: jsonSchema(z.strictObject({ status: z.string() })),
  permission: { action: 'complete', resourceType: 'station' },
  ui: { exception: 'integration principal' },
});
const reconcile = defineCapability({
  id: 'recipe.reconcile',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ effectId: z.string(), applied: z.boolean(), note: z.string().optional() }),
  ),
  output: jsonSchema(z.strictObject({ held: z.number() })),
  permission: { action: 'reconcile', resourceType: 'station' },
  ui: { exception: 'test fixture' },
});
type State = { recipe?: string; status: string };
const operator = { workspaceId: 'w', principalId: 'operator' };
const bridge = {
  workspaceId: 'w',
  principalId: 'station-bridge',
  grant: { operations: ['recipe.complete'] },
};

function fixture() {
  let ids = 0;
  const bind = createHandlerFactory<State, {}>();
  return createApplication({
    modules: [
      defineModule({
        id: 'station',
        capabilities: [load, complete, reconcile],
        requirements: {
          network: [
            {
              id: 'legacy-hmi-api',
              purpose: 'Test system of record',
              direction: 'outbound',
              scope: 'local',
              protocol: 'https',
              targets: ['legacy-hmi'],
              dataClasses: ['test-record'],
              availability: 'required',
              offline: 'queue',
            },
          ],
        },
      }),
    ],
    storage: createMemoryStorage<State>({ status: 'idle' }),
    services: {},
    newEffectId: () => `e${++ids}`,
    authorization: {
      authorize: ({ capability, context }) => ({
        allowed:
          (context.principalId === 'station-bridge') === (capability.id === 'recipe.complete'),
      }),
      canReadEvent: () => true,
    },
    handlers: [
      bind(load, (input, ctx) => {
        ctx.state.recipe = input.recipe;
        ctx.state.status = 'loading';
        ctx.change('station:1');
        return {
          effectId: ctx.enqueue({
            target: 'legacy-hmi',
            type: 'recipe.load',
            resource: 'station:1',
            payload: input,
          }),
        };
      }),
      bind(complete, (input, ctx) => {
        const effect = ctx.completeEffect(input.effectId, input.outcome as EffectOutcome);
        ctx.state.status = effect.status;
        ctx.change(effect.resource);
        return { status: effect.status };
      }),
      // The operator looked at the station: applied → complete as accepted; not applied → deliver again.
      bind(reconcile, (input, ctx) => {
        const effect = input.applied
          ? ctx.completeEffect(input.effectId, { status: 'accepted', externalRef: 'operator' })
          : ctx.releaseEffect(input.effectId);
        ctx.state.status = input.applied ? 'accepted' : 'loading';
        ctx.change(effect.resource);
        return { held: ctx.effects({ held: true }).length };
      }),
    ],
  });
}

/** A screen target whose procedure can be interrupted and whose readback can be unclear. */
function station() {
  const state = {
    delivered: 0,
    interruptNext: false,
    lookupResult: undefined as LookupResult,
  };
  const port: SystemOfRecordPort = {
    describe: () => ({ target: 'legacy-hmi', idempotentDelivery: false }),
    async deliver(_effect: Readonly<Effect>) {
      if (state.interruptNext) {
        state.interruptNext = false;
        throw new DeliveryUncertain('Operator input during step 3 of 5');
      }
      state.delivered++;
      return { status: 'accepted', externalRef: 'readback:R-12' };
    },
    async lookup() {
      return state.lookupResult;
    },
  };
  return { state, port };
}

test('an interrupted procedure is held, skipped by delivery and resolved by reconciliation', async () => {
  const app = fixture();
  const { state, port } = station();
  const dispatcher = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  const { result } = await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  state.interruptNext = true;
  expect(await dispatcher.runOnce()).toMatchObject({ held: 1, retried: 0 });

  // Held: still pending, but out of delivery; a drain does not wait for it.
  expect(await app.pendingEffects(bridge, { target: 'legacy-hmi' })).toHaveLength(0);
  const [held] = await app.pendingEffects(bridge, { includeHeld: true });
  expect(held).toMatchObject({
    status: 'pending',
    holdReason: 'Operator input during step 3 of 5',
  });
  expect(
    await dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true }),
  ).toMatchObject({ held: 0 });
  expect(state.delivered).toBe(0);
  expect(await dispatcher.drain(50)).toBe(0);

  // Not applied: released, delivered again on the next pass.
  await app.invoke(
    {
      operation: 'recipe.reconcile',
      input: { effectId: result.effectId, applied: false },
      idempotencyKey: 'reconcile-1',
    },
    operator,
  );
  expect(await dispatcher.runOnce()).toMatchObject({ accepted: 1 });
  expect(state.delivered).toBe(1);
});

test('a release is marked until the next attempt, so a lookup can tell a person decided', async () => {
  const app = fixture();
  const { state, port } = station();
  const dispatcher = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  const { result } = await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  state.interruptNext = true;
  await dispatcher.runOnce();
  const reconcile = (key: string) =>
    app.invoke(
      {
        operation: 'recipe.reconcile',
        input: { effectId: result.effectId, applied: false },
        idempotencyKey: key,
      },
      operator,
    );
  await reconcile('reconcile-1');
  const [released] = await app.pendingEffects(bridge, { target: 'legacy-hmi' });
  expect(released).toMatchObject({ attempts: 1, releasedAt: expect.any(Number) });
  // The next attempt is interrupted again: the release covered only the attempt before it.
  state.interruptNext = true;
  expect(await dispatcher.runOnce()).toMatchObject({ held: 1 });
  const [held] = await app.pendingEffects(bridge, { includeHeld: true });
  expect(held).toMatchObject({ attempts: 2 });
  expect(held!.releasedAt).toBeUndefined();
});

test('an uncertain lookup holds instead of delivering twice; applied completes it', async () => {
  const app = fixture();
  const { state, port } = station();
  const dispatcher = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  const { result } = await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  state.lookupResult = { status: 'uncertain', reason: 'Recipe screen shows R-12 but not loaded' };
  expect(await dispatcher.runOnce()).toMatchObject({ held: 1, accepted: 0 });
  expect(state.delivered).toBe(0);

  const reconciled = await app.invoke(
    {
      operation: 'recipe.reconcile',
      input: { effectId: result.effectId, applied: true },
      idempotencyKey: 'reconcile-1',
    },
    operator,
  );
  // Completing clears the hold in the same transaction.
  expect(reconciled.result).toEqual({ held: 0 });
  expect(await app.pendingEffects(bridge, { includeHeld: true })).toHaveLength(0);
  expect(state.delivered).toBe(0);
});

test('only held effects can be released', async () => {
  const app = fixture();
  const { result } = await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  await expect(
    app.invoke(
      {
        operation: 'recipe.reconcile',
        input: { effectId: result.effectId, applied: false },
        idempotencyKey: 'reconcile-1',
      },
      operator,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('shutdown during an interrupted procedure still records the uncertain outcome', async () => {
  const app = fixture();
  const controller = new AbortController();
  const port: SystemOfRecordPort = {
    describe: () => ({ target: 'legacy-hmi', idempotentDelivery: false }),
    // The procedure acted on the screen, then shutdown interrupted it.
    async deliver() {
      controller.abort();
      throw new DeliveryUncertain('Interrupted after step 2 of 5');
    },
    async lookup() {
      return undefined;
    },
  };
  const dispatcher = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  expect(await dispatcher.runOnce(controller.signal)).toMatchObject({ held: 1 });
  // Without the record, a restart would see attempts === 0 and deliver again.
  const [held] = await app.pendingEffects(bridge, { includeHeld: true });
  expect(held).toMatchObject({ attempts: 1, holdReason: 'Interrupted after step 2 of 5' });
});

test('a drain deadline aborts a delivery that is still in flight', async () => {
  const app = fixture();
  let aborted = false;
  const port: SystemOfRecordPort = {
    describe: () => ({ target: 'legacy-hmi', idempotentDelivery: true }),
    // A hung connector that honors its signal and never acted.
    deliver: (_effect, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }),
      ),
  };
  const dispatcher = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  const started = performance.now();
  expect(await dispatcher.drain(30, 5)).toBe(1);
  expect(performance.now() - started).toBeLessThan(500);
  expect(aborted).toBe(true);
}, 2_000);

test('draining several targets accounts for outbox work no dispatcher here can deliver', async () => {
  const app = fixture();
  const { port } = station();
  await app.invoke(
    { operation: 'recipe.load', input: { recipe: 'R-12' }, idempotencyKey: 'load-1' },
    operator,
  );
  const mes = createEffectDispatcher({
    application: app,
    port: { ...port, describe: () => ({ target: 'mes', idempotentDelivery: false }) },
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  // Only an MES dispatcher runs here; the station effect is still owed and must be reported.
  expect(
    await drainTargets({ application: app, context: bridge, dispatchers: [mes], timeoutMs: 0 }),
  ).toEqual({
    pending: 1,
    targets: [
      { target: 'legacy-hmi', pending: 1, held: 0, acknowledged: 0, deliverable: false },
      { target: 'mes', pending: 0, held: 0, acknowledged: 0, deliverable: true },
    ],
  });
  const hmi = createEffectDispatcher({
    application: app,
    port,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  expect(
    await drainTargets({
      application: app,
      context: bridge,
      dispatchers: [mes, hmi],
      timeoutMs: 1_000,
    }),
  ).toMatchObject({ pending: 0 });
});
