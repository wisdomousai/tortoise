import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, defineTarget, jsonSchema } from '@tortoise/contracts';
import { createMemoryEventLog } from '@tortoise/event-log';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  definePolicy,
  effectPhase,
  own,
  put,
  type Effect,
} from '@tortoise/runtime';
import {
  createEffectDispatcher,
  DeliveryFailure,
  drainTargets,
  completeDelivery,
  targetContext,
  targetHandlers,
  targetAllowlist,
  targetRules,
  type Delivered,
  type DeliveryResult,
  type LookupResult,
} from '../src/index';

const erp = defineTarget({
  target: 'erp',
  resourceType: 'ErpSync',
  changes: ['reading'],
  feed: {
    item: z.strictObject({ code: z.string(), version: z.number().int() }),
    max: 10,
    changes: ['code'],
  },
  status: {},
  descriptions: { complete: 'Complete a reading.', status: 'ERP synchronization.' },
});
const fixture = { ui: { exception: 'test fixture' } } as const;
const readingId = jsonSchema(z.strictObject({ id: z.string() }));
const record = defineCapability({
  id: 'reading.record',
  kind: 'command',
  input: readingId,
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'create', resourceType: 'Reading' },
  ...fixture,
});
const withdraw = defineCapability({
  id: 'reading.withdraw',
  kind: 'command',
  input: readingId,
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'update', resourceType: 'Reading' },
  ...fixture,
});
const roleSet = defineCapability({
  id: 'role.set',
  kind: 'command',
  input: jsonSchema(z.strictObject({ principalId: z.string(), operator: z.boolean() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'manage', resourceType: 'Role' },
  ...fixture,
});

type Reading = Delivered & { withdrawn?: boolean };
type State = {
  operators: Record<string, true>;
  readings: Record<string, Reading>;
  codes: Record<string, number>;
  versions: Record<string, number>;
  sync: { watermark?: string; lastSyncAt?: number };
};
const person = (principalId: string) => ({ workspaceId: 'w', principalId });
const integration = targetContext(erp, 'w', 'erp-bot');
const LEASE = 1_000;

function setup() {
  let clock = 1_000;
  let ids = 0;
  const log = createMemoryEventLog();
  const bind = createHandlerFactory<State, {}>();
  // Recording needs the operator role and, on the state before the command, no such reading:
  // a precondition the dispatch recheck must not ask again once the reading exists.
  const policy = definePolicy<State, 'operator'>({
    roleOf: (state, principalId) => (state.operators[principalId] ? 'operator' : undefined),
    integrations: [targetAllowlist(erp, (_state, principalId) => principalId === 'erp-bot')],
    operations: {
      ...targetRules(erp),
      [record.id]: {
        container: () => 'site',
        roles: ['operator'],
        commit: 'previous',
        allow: ({ input, state }) => !own(state.readings, String(input.id)),
      },
      [withdraw.id]: { container: () => 'site', roles: ['operator'] },
      [roleSet.id]: 'open',
    },
    // Only operators read readings, so a revoked operator stops seeing their outcome.
    events: {
      reading: { container: () => 'site' },
      code: () => true,
      sync: () => true,
      role: () => true,
    },
  });
  const app = createApplication({
    modules: [
      defineModule({
        id: 'readings',
        capabilities: [record, withdraw, roleSet, ...erp.capabilities],
      }),
    ],
    storage: createMemoryStorage<State>({
      operators: { ann: true, vic: true },
      readings: {},
      codes: {},
      versions: {},
      sync: {},
    }),
    services: {},
    eventLog: log,
    newEffectId: () => `e${++ids}`,
    now: () => clock,
    authorization: policy,
    handlers: [
      bind(record, (input, ctx) => {
        const effectId = ctx.enqueue({
          target: 'erp',
          type: 'reading.post',
          resource: `reading:${input.id}`,
          payload: { id: input.id },
        });
        put(ctx.state.readings, input.id, { effectId, sync: 'pending' });
        ctx.change(`reading:${input.id}`, 'created');
        return { effectId };
      }),
      bind(withdraw, (input, ctx) => {
        const reading = own(ctx.state.readings, input.id)!;
        ctx.cancelEffect(reading.effectId, 'Withdrawn by the operator');
        reading.withdrawn = true;
        ctx.change(`reading:${input.id}`);
        return {};
      }),
      bind(roleSet, (input, ctx) => {
        if (input.operator) ctx.state.operators[input.principalId] = true;
        else delete ctx.state.operators[input.principalId];
        ctx.invalidateAuthorization();
        ctx.change(`role:${input.principalId}`);
        return {};
      }),
      ...targetHandlers<State, {}, { code: string; version: number }>(erp, {
        cursor: (state) => state.sync,
        now: () => clock,
        onOutcome: (effect, outcome, ctx) =>
          completeDelivery(own(ctx.state.readings, effect.resource.slice(8)), effect, outcome),
        applyBatch: ({ items }, ctx) => {
          for (const item of items) ctx.state.codes[item.code] = item.version;
          return items.length;
        },
        versions: {
          store: (state) => state.versions,
          of: (item) => ({ key: item.code, version: item.version }),
        },
        status: () => ({}),
      }),
    ],
  });
  const effect = async (id: string): Promise<Effect> =>
    (await app.pendingEffects(integration, { includeHeld: true })).find(
      (candidate) => candidate.id === id,
    )!;
  return {
    app,
    log,
    effect,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
    recordReading: async (id: string, by = 'ann') =>
      (
        (await app.invokeRaw({ operation: record.id, input: { id } }, person(by))).result as {
          effectId: string;
        }
      ).effectId,
  };
}

/** A target whose deliveries and lookups follow a script; each call takes the next step. */
function scriptedTarget(options: { idempotent?: boolean } = {}) {
  const deliveries: string[] = [];
  const deliver: (() => Promise<DeliveryResult>)[] = [];
  const known = new Map<string, LookupResult>();
  return {
    deliveries,
    deliver,
    known,
    port: {
      describe: () => ({ target: 'erp', idempotentDelivery: options.idempotent ?? true }),
      async deliver(effect: Readonly<Effect>) {
        deliveries.push(effect.id);
        const step = deliver.shift();
        return step ? step() : { status: 'accepted' as const, externalRef: `ERP-${effect.id}` };
      },
      lookup: async (effectId: string) => known.get(effectId),
    },
  };
}

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await Bun.sleep(1);
  if (!check()) throw new Error('Condition not reached');
}
const dispatcher = (
  env: ReturnType<typeof setup>,
  target: ReturnType<typeof scriptedTarget>,
  worker: string,
) =>
  createEffectDispatcher({
    application: env.app,
    port: target.port,
    context: integration,
    completeOperation: erp.complete.id,
    completeInput: (effect, outcome, attempt) => ({
      effectId: effect.id,
      outcome,
      fence: attempt.fence,
    }),
    worker,
    leaseMs: LEASE,
    now: env.now,
  });

describe('delivery reliability', () => {
  test('a worker that paused past its lease cannot overwrite the worker after it', async () => {
    const env = setup();
    const id = await env.recordReading('r1');
    const target = scriptedTarget();
    const pausedA = gate();
    const pausedB = gate();
    target.deliver.push(
      async () => {
        await pausedA.opened;
        throw new DeliveryFailure('Timed out');
      },
      async () => {
        await pausedB.opened;
        return { status: 'accepted', externalRef: 'ERP-1' };
      },
    );
    const passA = dispatcher(env, target, 'a').runOnce();
    await until(() => target.deliveries.length === 1);
    expect(effectPhase(await env.effect(id), env.now())).toBe('claimed');
    env.advance(LEASE + 1);
    const passB = dispatcher(env, target, 'b').runOnce();
    await until(() => target.deliveries.length === 2);
    // A wakes up and reports its timeout under the old fence: refused, nothing recorded.
    pausedA.open();
    expect(await passA).toMatchObject({ deferred: 1, retried: 0 });
    expect(await env.effect(id)).toMatchObject({ attempts: 0, claim: { worker: 'b', fence: 2 } });
    // What A saw is kept as evidence in the audit log, not in the workspace.
    expect(env.log.events()).toContainEqual(
      expect.objectContaining({
        kind: 'effect.attempted',
        outcome: 'denied',
        reason: 'SUPERSEDED',
        data: expect.objectContaining({ effectId: id, fence: 1, failure: 'Timed out' }),
      }),
    );
    pausedB.open();
    expect(await passB).toMatchObject({ accepted: 1 });
    expect(await env.effect(id)).toBeUndefined();

    // A completion under a superseded fence conflicts; the current one completes.
    const second = await env.recordReading('r2');
    await env.app.claimEffect(integration, second, { worker: 'a', leaseMs: LEASE });
    env.advance(LEASE + 1);
    await env.app.claimEffect(integration, second, { worker: 'b', leaseMs: LEASE });
    const complete = (fence: number) =>
      env.app.invokeRaw(
        {
          operation: erp.complete.id,
          input: { effectId: second, outcome: { status: 'accepted' }, fence },
        },
        integration,
      );
    await expect(complete(1)).rejects.toMatchObject({ code: 'CONFLICT' });
    await complete(2);
  });

  test('a kill after the target accepted creates no second record', async () => {
    const env = setup();
    const id = await env.recordReading('r1');
    const target = scriptedTarget({ idempotent: false });
    const kill = new AbortController();
    target.deliver.push(async () => {
      target.known.set(id, { status: 'accepted', externalRef: 'ERP-1' });
      kill.abort();
      throw new Error('process killed');
    });
    expect(await dispatcher(env, target, 'a').runOnce(kill.signal)).toMatchObject({ accepted: 0 });
    // The restarted process waits out the dead worker's lease, then finds the record.
    const restarted = dispatcher(env, target, 'b');
    expect(await restarted.runOnce()).toMatchObject({ deferred: 1 });
    env.advance(LEASE + 1);
    expect(await restarted.runOnce()).toMatchObject({ accepted: 1 });
    expect(target.deliveries).toEqual([id]);
  });

  test('an acknowledged effect is polled instead of delivered again, and drains as delivered', async () => {
    const env = setup();
    const id = await env.recordReading('r1');
    const target = scriptedTarget();
    target.deliver.push(async () => ({ status: 'pending', externalRef: 'QUEUE-7' }));
    const worker = dispatcher(env, target, 'a');
    expect(await worker.runOnce()).toMatchObject({ acknowledged: 1 });
    expect(await env.effect(id)).toMatchObject({ externalRef: 'QUEUE-7', attempts: 1 });
    expect(effectPhase(await env.effect(id), env.now())).toBe('acknowledged');
    target.known.set(id, { status: 'pending' });
    expect(await worker.drain(50)).toBe(0);
    const drained = await drainTargets({
      application: env.app,
      context: integration,
      dispatchers: [worker],
      timeoutMs: 10,
    });
    expect(drained).toMatchObject({ pending: 0, targets: [{ target: 'erp', acknowledged: 1 }] });
    env.advance(60_000);
    expect(await worker.runOnce()).toMatchObject({ acknowledged: 1 });
    target.known.set(id, { status: 'accepted', externalRef: 'ERP-1' });
    env.advance(60_000);
    expect(await worker.runOnce()).toMatchObject({ accepted: 1 });
    expect(target.deliveries).toEqual([id]);

    // A target that forgets an acknowledged effect leaves it for a person, never redelivered.
    const lost = await env.recordReading('r2');
    target.deliver.push(async () => ({ status: 'pending' }));
    await worker.runOnce();
    env.advance(60_000);
    expect(await worker.runOnce()).toMatchObject({ held: 1 });
    expect(effectPhase(await env.effect(lost), env.now())).toBe('held');
  });

  test('a command cancels an effect no worker claimed, and cannot once one did', async () => {
    const env = setup();
    const id = await env.recordReading('r1');
    await env.app.invokeRaw({ operation: withdraw.id, input: { id: 'r1' } }, person('ann'));
    const target = scriptedTarget();
    expect(await dispatcher(env, target, 'a').runOnce()).toMatchObject({ accepted: 0 });
    expect(target.deliveries).toEqual([]);
    expect(await env.effect(id)).toBeUndefined();

    const claimed = await env.recordReading('r2');
    await env.app.claimEffect(integration, claimed, { worker: 'a', leaseMs: LEASE });
    await expect(
      env.app.invokeRaw({ operation: withdraw.id, input: { id: 'r2' } }, person('ann')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('the original actor is authorized again before the first delivery', async () => {
    const env = setup();
    const annReading = await env.recordReading('r1', 'ann');
    await env.recordReading('r2', 'vic');
    await env.app.invokeRaw(
      { operation: roleSet.id, input: { principalId: 'ann', operator: false } },
      person('vic'),
    );
    const target = scriptedTarget();
    // Vic's reading exists now, so the command's precondition would fail; only roles count.
    expect(await dispatcher(env, target, 'a').runOnce()).toMatchObject({ accepted: 1, held: 1 });
    expect(target.deliveries).toEqual(['e2']);
    const held = await env.effect(annReading);
    expect(effectPhase(held, env.now())).toBe('held');
    expect(held.holdReason).toContain('reading.record');
    expect(held.input).toBeUndefined();
  });

  test('feed items not newer than the applied source version are dropped', async () => {
    const env = setup();
    const sync = (from: string | undefined, to: string, items: unknown[]) =>
      env.app.invokeRaw(
        { operation: erp.sync!.id, input: { ...(from ? { from } : {}), to, items } },
        integration,
      );
    await sync(undefined, 'w1', [{ code: 'a', version: 2 }]);
    const late = await sync('w1', 'w2', [
      { code: 'a', version: 1 },
      { code: 'b', version: 1 },
      { code: 'b', version: 1 },
    ]);
    expect(late.result).toEqual({ watermark: 'w2', items: 1 });
    const { data } = await env.app.queryRaw({ operation: erp.status.id, input: {} }, integration);
    expect(data).toMatchObject({ watermark: 'w2' });
  });

  test('a result dispatched before revocation is still recorded, unseen by the revoked actor', async () => {
    const env = setup();
    const id = await env.recordReading('r1', 'ann');
    const target = scriptedTarget();
    target.deliver.push(async () => {
      throw new DeliveryFailure('Busy');
    });
    const worker = dispatcher(env, target, 'a');
    expect(await worker.runOnce()).toMatchObject({ retried: 1 });
    await env.app.invokeRaw(
      { operation: roleSet.id, input: { principalId: 'ann', operator: false } },
      person('vic'),
    );
    env.advance(60_000);
    expect(await worker.runOnce()).toMatchObject({ accepted: 1, held: 0 });
    expect(await env.effect(id)).toBeUndefined();
    const visible = async (who: string) =>
      (await env.app.events(0, person(who))).events.filter(
        (event: { resource: string }) => event.resource === 'reading:r1',
      );
    expect(await visible('vic')).not.toHaveLength(0);
    expect(await visible('ann')).toHaveLength(0);
  });
});
