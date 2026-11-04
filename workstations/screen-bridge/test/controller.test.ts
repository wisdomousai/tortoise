import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { DeliveryFailure, DeliveryUncertain, createEffectDispatcher } from '@tortoise/integration';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type EffectOutcome,
} from '@tortoise/runtime';
import { createStationConnector, type BridgeControl } from '../src/controller';
import { createAccessibilityExtractor } from '../src/recognition/accessibility';
import { createScriptedDriver } from '../src/scripted-driver';
import type { Extractor } from '../src/ports';
import { parseProfile } from '../src/profile';
import { createCounterModel, createHmi, effect, profile, profileDocument } from './support';

const present = { recipe: 'R-12', presence: { confirmedBy: 'op-7' } };

function connectorFixture(
  initial: Partial<BridgeControl> = {},
  options: {
    profile?: typeof profile;
    extractors?: (hmi: ReturnType<typeof createHmi>) => Extractor[];
  } = {},
) {
  const hmi = createHmi();
  const control: { -readonly [K in keyof BridgeControl]: BridgeControl[K] } & {
    onRead?: (reads: number) => Partial<BridgeControl> | void;
  } = {
    mode: 'actuate',
    holder: 'agent',
    ...initial,
  };
  let reads = 0;
  const connector = createStationConnector({
    profile: options.profile ?? profile,
    transport: hmi.transport,
    extractors: options.extractors?.(hmi) ?? [
      createAccessibilityExtractor(),
      createCounterModel(hmi).extractor,
    ],
    driver: createScriptedDriver(),
    control: async () => {
      Object.assign(control, control.onRead?.(++reads) ?? {});
      return { mode: control.mode, holder: control.holder };
    },
    now: () => hmi.state.clock,
    sleep: async () => {
      hmi.state.clock += 100;
    },
  });
  return { hmi, control, connector, signal: new AbortController().signal };
}

test('a procedure runs through the screen and is accepted by readback', async () => {
  const { hmi, connector, signal } = connectorFixture();
  const outcome = await connector.deliver(effect(present), signal);
  expect(outcome).toMatchObject({
    status: 'accepted',
    externalRef: expect.stringMatching(/^readback:/),
  });
  expect(hmi.state.recipe).toBe('R-12');
  expect(hmi.state.actions.map((action) => action.kind)).toEqual([
    'click',
    'click',
    'type',
    'click',
  ]);
  expect(hmi.state.estopResets).toBe(0);
});

test('a station already showing the desired state is accepted without acting', async () => {
  const { hmi, connector, signal } = connectorFixture();
  hmi.state.recipe = 'R-12';
  expect(await connector.deliver(effect(present), signal)).toMatchObject({ status: 'accepted' });
  expect(hmi.state.actions).toHaveLength(0);
});

test('unmet preconditions and missing presence are rejected without acting', async () => {
  const { hmi, connector, signal } = connectorFixture();
  expect(await connector.deliver(effect({ recipe: 'R-12' }), signal)).toMatchObject({
    status: 'rejected',
    code: 'PRECONDITION',
  });
  hmi.state.machine = 'RUNNING';
  expect(await connector.deliver(effect(present), signal)).toMatchObject({
    status: 'rejected',
    code: 'PRECONDITION',
    message: expect.stringContaining('machine is RUNNING'),
  });
  expect(await connector.deliver(effect(present, { type: 'machine.jog' }), signal)).toMatchObject({
    status: 'rejected',
    code: 'UNSUPPORTED',
  });
  expect(hmi.state.actions).toHaveLength(0);
});

test('monitor-only, assist for procedures above risk none, and an operator holding control block without acting', async () => {
  for (const control of [
    { mode: 'monitor-only' as const },
    { mode: 'assist' as const },
    { holder: 'operator' as const },
  ]) {
    const { hmi, connector, signal } = connectorFixture(control);
    const attempt = connector.deliver(effect(present), signal);
    await expect(attempt).rejects.toBeInstanceOf(DeliveryFailure);
    await expect(attempt).rejects.not.toBeInstanceOf(DeliveryUncertain);
    expect(hmi.state.actions).toHaveLength(0);
  }
});

test('an unexpected popup mid-procedure makes the delivery uncertain', async () => {
  const { hmi, connector, signal } = connectorFixture();
  hmi.state.popupAfter = 1;
  await expect(connector.deliver(effect(present), signal)).rejects.toBeInstanceOf(
    DeliveryUncertain,
  );
  expect(hmi.state.actions).toHaveLength(1);
  // Lookup cannot tell whether the dialog took effect: the station shows neither result nor start.
  expect(await connector.lookup!('e1', signal, effect(present, { attempts: 1 }))).toMatchObject({
    status: 'uncertain',
  });
  // Once someone closed the popup and the start screen is back without the recipe, deliver again.
  hmi.state.screen = 'main';
  expect(await connector.lookup!('e1', signal, effect(present, { attempts: 1 }))).toBeUndefined();
});

test('a popup after a click stops the procedure before it types into the wrong screen', async () => {
  const { hmi, connector, signal } = connectorFixture();
  // The popup replaces the recipe dialog right after the text box was clicked.
  hmi.state.popupAfter = 2;
  await expect(connector.deliver(effect(present), signal)).rejects.toBeInstanceOf(
    DeliveryUncertain,
  );
  expect(hmi.state.actions.map((action) => action.kind)).toEqual(['click', 'click']);
});

/** The loaded recipe, read by a model that misreads it once with full confidence. */
function flakyRecipe(misreads: string[]): (hmi: ReturnType<typeof createHmi>) => Extractor[] {
  return (hmi) => [
    createAccessibilityExtractor(),
    createCounterModel(hmi).extractor,
    {
      id: 'vision',
      modality: 'vision',
      async extract(_frame, fields) {
        return fields
          .filter((field) => field.id === 'recipe')
          .map((field) => ({
            field: field.id,
            value: misreads.shift() ?? hmi.state.recipe,
            confidence: 1,
          }));
      },
    },
  ];
}
const stableRecipe = parseProfile({
  ...profileDocument,
  fields: profileDocument.fields.map((field) =>
    field.id === 'recipe' ? { ...field, extractor: 'vision', stableReads: 3 } : field,
  ),
});

test('one confident transient reading never establishes the requested state', async () => {
  const { hmi, connector, signal } = connectorFixture(
    {},
    { profile: stableRecipe, extractors: flakyRecipe(['R-12']) },
  );
  const outcome = await connector.deliver(effect(present), signal);
  // The procedure ran, because the station did not actually show R-12, and readback agreed.
  expect(hmi.state.actions.length).toBeGreaterThan(0);
  expect(hmi.state.recipe).toBe('R-12');
  expect(outcome).toMatchObject({ status: 'accepted' });
});

test('lookup needs the declared stable reads before it accepts an earlier delivery', async () => {
  const { connector, signal } = connectorFixture(
    {},
    { profile: stableRecipe, extractors: flakyRecipe(['R-12']) },
  );
  // The misread is not confirmed; back on the start screen, so the effect is delivered again.
  expect(await connector.lookup!('e1', signal, effect(present, { attempts: 1 }))).toBeUndefined();
});

test('local input at the station stops the procedure before the next action', async () => {
  const { hmi, connector, signal } = connectorFixture();
  hmi.state.localInputAfter = 2;
  await expect(connector.deliver(effect(present), signal)).rejects.toThrow(
    'Someone used the station',
  );
  expect(hmi.state.actions).toHaveLength(2);
});

test('a confirm that does not stick fails readback as uncertain', async () => {
  const { hmi, connector, signal } = connectorFixture();
  hmi.state.swallowConfirm = true;
  await expect(connector.deliver(effect(present), signal)).rejects.toThrow(
    'does not show the result',
  );
  expect(hmi.state.recipe).toBe('R-10');
});

test('the runtime refuses a resolved point inside a forbidden region', async () => {
  const { hmi, connector, signal } = connectorFixture();
  // A driver (or a moved button) that resolves onto the e-stop reset is stopped before acting.
  const box = hmi.boxes.load;
  Object.assign(box, { x: 800, y: 680 });
  await expect(connector.deliver(effect(present), signal)).rejects.toThrow('forbidden estop-reset');
  expect(hmi.state.actions).toHaveLength(0);
  expect(hmi.state.estopResets).toBe(0);
});

test('lookup: converged is accepted, untouched attempts and fresh effects deliver', async () => {
  const { hmi, connector, control, signal } = connectorFixture({ holder: 'operator' });
  await expect(connector.deliver(effect(present), signal)).rejects.toBeInstanceOf(DeliveryFailure);
  hmi.state.screen = 'recipe';
  // Attempted by this process but never touched the screen: safe to deliver again.
  expect(await connector.lookup!('e1', signal, effect(present, { attempts: 1 }))).toBeUndefined();
  // After a restart nothing is remembered: the same screen is uncertain.
  const restarted = connectorFixture();
  restarted.hmi.state.screen = 'recipe';
  expect(
    await restarted.connector.lookup!('e1', signal, effect(present, { attempts: 1 })),
  ).toMatchObject({
    status: 'uncertain',
  });
  expect(await restarted.connector.lookup!('e1', signal, effect(present))).toBeUndefined();
  hmi.state.screen = 'main';
  hmi.state.recipe = 'R-12';
  control.holder = 'agent';
  expect(await connector.lookup!('e1', signal, effect(present, { attempts: 3 }))).toMatchObject({
    status: 'accepted',
  });
});

const outcome = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().optional() }),
  z.strictObject({ status: z.literal('rejected'), code: z.string(), message: z.string() }),
]);
const start = defineCapability({
  id: 'recipe.start',
  kind: 'command',
  input: jsonSchema(z.strictObject({ recipe: z.string(), confirmedBy: z.string() })),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'start', resourceType: 'station' },
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
  input: jsonSchema(z.strictObject({ effectId: z.string(), applied: z.boolean() })),
  output: jsonSchema(z.strictObject({ status: z.string() })),
  permission: { action: 'reconcile', resourceType: 'station' },
  ui: { exception: 'test fixture' },
});

test('operator takeover mid-procedure holds the effect until a person reconciles it', async () => {
  const bind = createHandlerFactory<{ status: string }, {}>();
  let ids = 0;
  const app = createApplication({
    modules: [
      defineModule({
        id: 'station',
        capabilities: [start, complete, reconcile],
        requirements: {
          network: [
            {
              id: 'legacy-hmi-api',
              purpose: 'Test system of record',
              direction: 'outbound',
              scope: 'site',
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
    storage: createMemoryStorage<{ status: string }>({ status: 'idle' }),
    services: {},
    newEffectId: () => `e${++ids}`,
    authorization: {
      authorize: ({ capability, context }) => ({
        allowed:
          (context.principalId === 'station-bridge:line-1') ===
          (capability.id === 'recipe.complete'),
      }),
      canReadEvent: () => true,
    },
    handlers: [
      bind(start, (input, ctx) => {
        ctx.change('station:1');
        return {
          effectId: ctx.enqueue({
            target: 'legacy-hmi',
            type: 'recipe.load',
            resource: 'station:1',
            payload: { recipe: input.recipe, presence: { confirmedBy: input.confirmedBy } },
          }),
        };
      }),
      bind(complete, (input, ctx) => {
        const completed = ctx.completeEffect(input.effectId, input.outcome as EffectOutcome);
        ctx.state.status = completed.status;
        ctx.change(completed.resource);
        return { status: completed.status };
      }),
      bind(reconcile, (input, ctx) => {
        const resolved = input.applied
          ? ctx.completeEffect(input.effectId, { status: 'accepted', externalRef: 'operator' })
          : ctx.releaseEffect(input.effectId);
        ctx.change(resolved.resource);
        return { status: resolved.status };
      }),
    ],
  });
  const operator = { workspaceId: 'w', principalId: 'operator' };
  const bridge = { workspaceId: 'w', principalId: 'station-bridge:line-1' };
  const { hmi, control, connector } = connectorFixture();
  // The operator presses "Take over" while the agent is between the dialog's click and typing.
  control.onRead = (reads) => (reads === 4 ? { holder: 'operator' } : undefined);
  const dispatcher = createEffectDispatcher({
    application: app,
    port: connector,
    context: bridge,
    completeOperation: 'recipe.complete',
  });
  const { result } = await app.invoke(
    {
      operation: 'recipe.start',
      input: { recipe: 'R-12', confirmedBy: 'op-7' },
      idempotencyKey: 's1',
    },
    operator,
  );
  expect(await dispatcher.runOnce()).toMatchObject({ held: 1 });
  expect(hmi.state.screen).toBe('recipe');
  const [held] = await app.pendingEffects(bridge, { includeHeld: true });
  expect(held).toMatchObject({ holdReason: 'The operator has the station' });

  // Held effects are not redelivered, even after the operator hands back.
  control.onRead = undefined;
  control.holder = 'agent';
  expect(await dispatcher.runOnce(undefined, { ignoreBackoff: true })).toMatchObject({
    held: 0,
    accepted: 0,
  });

  // The operator cancels the dialog and reports it was not applied: delivered again, accepted.
  hmi.state.screen = 'main';
  await app.invoke(
    {
      operation: 'recipe.reconcile',
      input: { effectId: result.effectId, applied: false },
      idempotencyKey: 'r1',
    },
    operator,
  );
  expect(await dispatcher.runOnce(undefined, { ignoreBackoff: true })).toMatchObject({
    accepted: 1,
  });
  expect(hmi.state.recipe).toBe('R-12');
});
