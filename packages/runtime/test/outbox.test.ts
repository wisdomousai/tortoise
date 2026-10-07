import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type EffectOutcome,
} from '../src/index';

const record = defineCapability({
  id: 'result.record',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), value: z.number() })),
  output: jsonSchema(z.strictObject({ id: z.string(), effectId: z.string() })),
  permission: { action: 'create', resourceType: 'result' },
  ui: { exception: 'test fixture' },
  integration: { target: 'sor', delivery: 'outbox' },
});
const outcome = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().optional() }),
  z.strictObject({ status: z.literal('rejected'), code: z.string(), message: z.string() }),
]);
const settle = defineCapability({
  id: 'result.settle',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string(), outcome })),
  output: jsonSchema(z.strictObject({ status: z.string() })),
  permission: { action: 'settle', resourceType: 'result' },
  ui: { exception: 'integration principal' },
});
const status = defineCapability({
  id: 'result.sync-status',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ pending: z.number(), rejected: z.number() })),
  permission: { action: 'read', resourceType: 'result' },
  ui: { exception: 'test fixture' },
});
const module = defineModule({
  id: 'results',
  capabilities: [record, settle, status],
  requirements: {
    network: [
      {
        id: 'sor-api',
        purpose: 'Test system of record',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['sor'],
        dataClasses: ['test-record'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
});
type State = { results: Record<string, { value: number; sync: string; effectId: string }> };
const owner = { workspaceId: 'w', principalId: 'inspector' };
const integration = { workspaceId: 'w', principalId: 'integration' };

function fixture(options: { declareChange?: boolean; invalidOutput?: boolean } = {}) {
  const storage = createMemoryStorage<State>({ results: {} });
  const bind = createHandlerFactory<State, {}>();
  let sequence = 0;
  const app = createApplication({
    modules: [module],
    storage,
    services: {},
    newEffectId: () => `effect-${++sequence}`,
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      bind(record, (input, ctx) => {
        const effectId = ctx.enqueue({
          target: 'sor',
          type: 'result.post',
          resource: `result:${input.id}`,
          payload: { id: input.id, value: input.value },
        });
        ctx.state.results[input.id] = { value: input.value, sync: 'pending', effectId };
        if (options.declareChange !== false) ctx.change(`result:${input.id}`);
        return options.invalidOutput
          ? (null as unknown as { id: string; effectId: string })
          : { id: input.id, effectId };
      }),
      bind(settle, (input, ctx) => {
        const effect = ctx.settleEffect(input.effectId, input.outcome as EffectOutcome);
        const id = effect.resource.slice('result:'.length);
        ctx.state.results[id]!.sync = effect.status;
        ctx.change(effect.resource);
        return { status: effect.status };
      }),
      bind(status, (_, ctx) => ({
        pending: ctx.effects({ status: 'pending' }).length,
        rejected: ctx.effects({ status: 'rejected' }).length,
      })),
    ],
  });
  return { app, storage };
}

describe('transactional outbox', () => {
  test('a committed command persists its effect with the receipt and journal', async () => {
    const { app } = fixture();
    const receipt = await app.invoke(
      { operation: 'result.record', input: { id: 'r1', value: 10.02 }, idempotencyKey: 'k1' },
      owner,
    );
    expect(receipt.effects).toEqual(['effect-1']);
    const pending = await app.pendingEffects(integration, { target: 'sor' });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: 'effect-1',
      target: 'sor',
      operation: 'result.record',
      principalId: 'inspector',
      status: 'pending',
      attempts: 0,
      payload: { id: 'r1', value: 10.02 },
    });
    expect((await app.query({ operation: 'result.sync-status', input: {} }, owner)).data).toEqual({
      pending: 1,
      rejected: 0,
    });
  });

  test('an idempotent replay returns the stored receipt without enqueuing again', async () => {
    const { app } = fixture();
    const request = {
      operation: 'result.record' as const,
      input: { id: 'r1', value: 1 },
      idempotencyKey: 'scanner-double-send',
    };
    const first = await app.invoke(request, owner);
    expect(await app.invoke(request, owner)).toEqual(first);
    expect(await app.pendingEffects(integration)).toHaveLength(1);
  });

  test('a rolled-back command commits no effect', async () => {
    const { app, storage } = fixture({ invalidOutput: true });
    await expect(
      app.invoke({ operation: 'result.record', input: { id: 'r1', value: 1 } }, owner),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(await storage.read('w', async (snapshot) => snapshot.effects)).toEqual({});
  });

  test('effects must ride on a declared changed resource', async () => {
    const { app, storage } = fixture({ declareChange: false });
    await expect(
      app.invoke({ operation: 'result.record', input: { id: 'r1', value: 1 } }, owner),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await storage.read('w', async (snapshot) => snapshot.effects)).toEqual({});
  });

  test('settlement commits the outcome with its domain update exactly once', async () => {
    const { app } = fixture();
    await app.invoke({ operation: 'result.record', input: { id: 'r1', value: 1 } }, owner);
    await app.invoke({ operation: 'result.record', input: { id: 'r2', value: 2 } }, owner);
    const accepted = await app.invoke(
      {
        operation: 'result.settle',
        input: { effectId: 'effect-1', outcome: { status: 'accepted', externalRef: 'QM-1' } },
        idempotencyKey: 'settle:effect-1',
      },
      integration,
    );
    expect(accepted.result).toEqual({ status: 'accepted' });
    expect(accepted.effects).toBeUndefined();
    await app.invoke(
      {
        operation: 'result.settle',
        input: {
          effectId: 'effect-2',
          outcome: { status: 'rejected', code: 'LOT_LOCKED', message: 'Inspection lot is locked' },
        },
      },
      integration,
    );
    expect((await app.query({ operation: 'result.sync-status', input: {} }, owner)).data).toEqual({
      pending: 0,
      rejected: 1,
    });
    await expect(
      app.invoke(
        {
          operation: 'result.settle',
          input: { effectId: 'effect-1', outcome: { status: 'accepted' } },
        },
        integration,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      app.invoke(
        {
          operation: 'result.settle',
          input: { effectId: 'missing', outcome: { status: 'accepted' } },
        },
        integration,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await app.pendingEffects(integration)).toEqual([]);
  });

  test('malformed outcomes are rejected before commit', async () => {
    const { app } = fixture();
    await app.invoke({ operation: 'result.record', input: { id: 'r1', value: 1 } }, owner);
    await expect(
      app.invoke(
        {
          operation: 'result.settle',
          input: { effectId: 'effect-1', outcome: { status: 'rejected', code: '', message: 'x' } },
        },
        integration,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await app.pendingEffects(integration)).toHaveLength(1);
  });

  test('a delivery attempt is journaled without changing the resource revision', async () => {
    const { app } = fixture();
    const receipt = await app.invoke(
      { operation: 'result.record', input: { id: 'r1', value: 1 } },
      owner,
    );
    const attempted = await app.recordAttempt(integration, 'effect-1', 'Target unavailable');
    expect(attempted).toMatchObject({ attempts: 1, lastFailure: 'Target unavailable' });
    const batch = await app.events(receipt.cursor, owner);
    expect(batch.events).toEqual([
      {
        cursor: receipt.cursor + 1,
        resource: 'result:r1',
        revision: receipt.revisions['result:r1']!,
        type: 'effect.attempted',
        operation: 'result.record',
      },
    ]);
    // An editor holding the observed revision is not given a false conflict by retry metadata.
    await app.invoke(
      {
        operation: 'result.settle',
        input: { effectId: 'effect-1', outcome: { status: 'accepted' } },
        expectedRevisions: { 'result:r1': receipt.revisions['result:r1']! },
      },
      integration,
    );
    await expect(app.recordAttempt(integration, 'effect-1', 'late')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
