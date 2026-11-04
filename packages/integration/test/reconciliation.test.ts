import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  jsonValueSchema,
  reconciliationOperations,
  type InputOf,
  type ReconciliationDecision,
} from '@tortoise/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  reconciliationHandlers,
  type Effect,
  type EffectOutcome,
} from '@tortoise/runtime';
import { DeliveryUncertain, createEffectDispatcher, type SystemOfRecordPort } from '../src/index';

// Two targets whose deliveries can end uncertain: a station screen and an ERP. Each person may
// reconcile only the effects of the records they work on.
const send = defineCapability({
  id: 'job.send',
  kind: 'command',
  input: jsonSchema(z.strictObject({ target: z.enum(['hmi', 'erp']), resource: z.string() })),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'write', resourceType: 'Job' },
  ui: { exception: 'test fixture' },
});
const complete = defineCapability({
  id: 'job.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string(), outcome: jsonValueSchema })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'complete', resourceType: 'Job' },
  ui: { exception: 'integration principal' },
});
const decisions = defineCapability({
  id: 'job.decisions',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ items: z.array(jsonValueSchema) })),
  permission: { action: 'read', resourceType: 'Job' },
  ui: { exception: 'test fixture' },
});
type State = { decisions: [string, ReconciliationDecision, string | null][] };
const scopes: Record<string, string> = { alice: 'station:', bob: 'order:' };
const person = (principalId: string) => ({ workspaceId: 'w', principalId });
const bridge = { workspaceId: 'w', principalId: 'bridge', grant: { operations: ['job.complete'] } };

function fixture() {
  let ids = 0;
  const bind = createHandlerFactory<State, {}>();
  const application = createApplication({
    modules: [
      defineModule({
        id: 'jobs',
        capabilities: [send, complete, decisions, ...Object.values(reconciliationOperations)],
        requirements: {
          network: [
            {
              id: 'systems',
              purpose: 'Test systems of record',
              direction: 'outbound',
              scope: 'local',
              protocol: 'https',
              targets: ['hmi', 'erp'],
              dataClasses: ['test-record'],
              availability: 'required',
              offline: 'queue',
            },
          ],
        },
      }),
    ],
    storage: createMemoryStorage<State>({ decisions: [] }),
    services: {},
    newEffectId: () => `e${++ids}`,
    authorization: {
      authorize: ({ capability, context }) => ({
        allowed: (context.principalId === 'bridge') === (capability.id === 'job.complete'),
      }),
      canReadEvent: () => true,
    },
    handlers: [
      bind(send, (input, ctx) => {
        ctx.change(input.resource);
        const effectId = ctx.enqueue({
          target: input.target,
          type: 'job.sent',
          resource: input.resource,
          payload: { resource: input.resource },
        });
        return { effectId };
      }),
      bind(complete, (input, ctx) => {
        ctx.change(ctx.completeEffect(input.effectId, input.outcome as EffectOutcome).resource);
        return {};
      }),
      bind(decisions, (_input, ctx) => ({ items: structuredClone(ctx.state.decisions) })),
      ...reconciliationHandlers<State, {}>({
        visible: (effect, ctx) =>
          effect.resource.startsWith(scopes[ctx.context.principalId] ?? '\u0000'),
        onResolved: (effect, decision, outcome, ctx) =>
          void ctx.state.decisions.push([
            effect.id,
            decision,
            outcome?.status === 'accepted' ? (outcome.externalRef ?? null) : null,
          ]),
      }),
    ],
  });
  const delivered: string[] = [];
  const uncertain = new Set<string>();
  const port = (target: string): SystemOfRecordPort => ({
    describe: () => ({ target, idempotentDelivery: false }),
    async deliver(effect: Readonly<Effect>) {
      if (uncertain.delete(effect.id)) throw new DeliveryUncertain('Reply lost after sending');
      delivered.push(effect.id);
      return { status: 'accepted' };
    },
    async lookup() {
      return undefined;
    },
  });
  const dispatchers = ['hmi', 'erp'].map((target) =>
    createEffectDispatcher({
      application,
      port: port(target),
      context: bridge,
      completeOperation: 'job.complete',
    }),
  );
  return { application, dispatchers, delivered, uncertain };
}

test('held effects of every target are listed to those who may see them and resolved by a person', async () => {
  const { application, dispatchers, delivered, uncertain } = fixture();
  const sendTo = async (target: 'hmi' | 'erp', resource: string, key: string) =>
    (
      await application.invoke(
        { operation: 'job.send', input: { target, resource }, idempotencyKey: key },
        person('alice'),
      )
    ).result.effectId;
  const station = await sendTo('hmi', 'station:1', 's1');
  const order = await sendTo('erp', 'order:7', 'o7');
  const refused = await sendTo('erp', 'order:8', 'o8');
  for (const id of [station, order, refused]) uncertain.add(id);
  for (const dispatcher of dispatchers) await dispatcher.runOnce();
  expect(delivered).toEqual([]);

  const list = async (principalId: string, input = {}) =>
    (
      (await application.query(
        { operation: 'reconciliation.list', input },
        person(principalId),
      )) as { data: { items: { id: string; target: string; holdReason?: string }[] } }
    ).data.items;
  const resolve = (
    principalId: string,
    input: InputOf<typeof reconciliationOperations.reconciliationResolve>,
    key: string,
  ) =>
    application.invoke(
      { operation: 'reconciliation.resolve', input, idempotencyKey: key },
      person(principalId),
    );

  // Each person sees the held effects of their own records, across targets.
  expect((await list('alice')).map((item) => [item.id, item.target])).toEqual([[station, 'hmi']]);
  expect((await list('bob')).map((item) => item.id)).toEqual([order, refused]);
  expect(await list('bob', { target: 'hmi' })).toEqual([]);
  expect((await list('bob', { resource: 'order:8' })).map((item) => item.id)).toEqual([refused]);
  expect((await list('alice'))[0]).toMatchObject({
    holdReason: 'Reply lost after sending',
    payload: { resource: 'station:1' },
  });

  // Someone else's effect reads as missing.
  await expect(
    resolve('alice', { effectId: order, decision: 'applied' }, 'alice-order'),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });

  // Not applied: released and delivered again on the next pass.
  expect(
    (await resolve('alice', { effectId: station, decision: 'not-applied' }, 'r1')).result,
  ).toEqual({ effectId: station, status: 'pending' });
  await dispatchers[0]!.runOnce();
  expect(delivered).toEqual([station]);

  // Applied: completed with the reference the person found; refused: completed as rejected.
  expect(
    (await resolve('bob', { effectId: order, decision: 'applied', externalRef: 'SO-7' }, 'r2'))
      .result,
  ).toEqual({ effectId: order, status: 'accepted' });
  await resolve('bob', { effectId: refused, decision: 'refused', reason: 'Order closed' }, 'r3');
  const effects = await application.pendingEffects(bridge, { includeHeld: true });
  expect(effects).toEqual([]);
  expect(await list('bob')).toEqual([]);
  await expect(
    resolve('bob', { effectId: order, decision: 'refused' }, 'again'),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await dispatchers[1]!.runOnce();
  expect(delivered).toEqual([station]);

  // The domain recorded each decision in the same transaction.
  expect(
    (
      (await application.query({ operation: 'job.decisions', input: {} }, person('bob'))) as {
        data: { items: unknown[] };
      }
    ).data.items,
  ).toEqual([
    [station, 'not-applied', null],
    [order, 'applied', 'SO-7'],
    [refused, 'refused', null],
  ]);
});
