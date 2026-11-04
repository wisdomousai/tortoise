import { describe, expect, test } from 'bun:test';
import {
  createApplication,
  createMemoryStorage,
  type CommandReceipt,
  type ExecutionContext,
} from '@tortoise/runtime';
import { createEffectDispatcher, createInboundSync } from '@tortoise/integration';
import {
  createQualityHandlers,
  createQualityState,
  qualityInspectionModule,
  qualityPolicy,
} from './server';
import { demoSeed, FakeQualitySystem, toSyncInput } from './fake-sor';

const T0 = 1_760_000_000_000;
const workspaceId = 'plant-floor';
const as = (principalId: string) => ({ workspaceId, principalId });
const supervisor = as('supervisor');
const inspector = as('ina');
const viewer = as('vic');
const integration = {
  ...as('integration'),
  grant: {
    operations: ['inspection.lot.sync', 'inspection.effect.complete', 'inspection.sync.status'],
  },
};

async function setup() {
  let clock = T0;
  let ids = 0;
  let effects = 0;
  const app = createApplication({
    modules: [qualityInspectionModule],
    handlers: createQualityHandlers(),
    storage: createMemoryStorage(createQualityState({ supervisorId: 'supervisor' })),
    authorization: qualityPolicy,
    services: { newId: () => `id-${++ids}`, now: () => clock },
    newEffectId: () => `effect-${++effects}`,
    now: () => clock,
  });
  const sor = new FakeQualitySystem();
  const inbound = createInboundSync({
    application: app,
    port: sor,
    context: integration,
    syncOperation: 'inspection.lot.sync',
    readCursor: async () =>
      (
        (await app.queryRaw({ operation: 'inspection.sync.status', input: {} }, integration))
          .data as { watermark?: string }
      ).watermark,
    toInput: toSyncInput,
  });
  const dispatcher = createEffectDispatcher({
    application: app,
    port: sor,
    context: integration,
    completeOperation: 'inspection.effect.complete',
    now: () => clock,
  });
  await inbound.runOnce();
  for (const [principalId, role] of [
    ['ina', 'inspector'],
    ['ian', 'inspector'],
    ['vic', 'viewer'],
  ] as const)
    await app.invokeRaw(
      { operation: 'inspection.plant.set-member', input: { plant: 'P100', principalId, role } },
      supervisor,
    );
  const command = (
    operation: string,
    input: unknown,
    context: ExecutionContext = inspector,
    extra = {},
  ): Promise<CommandReceipt<any>> => app.invokeRaw({ operation, input, ...extra }, context);
  // Tests assert on loosely typed output; generated clients carry the precise types.
  const query = async (operation: string, input: unknown, context = inspector): Promise<any> =>
    (await app.queryRaw({ operation, input }, context)).data;
  return {
    app,
    sor,
    inbound,
    dispatcher,
    command,
    query,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}
const measure = (characteristicId: string, value: number, at = T0 - 1_000) => ({
  characteristicId,
  value,
  occurredAt: at,
});

describe('quality inspection on top of a system of record', () => {
  test('inbound sync applies SoR master data under an ordered watermark', async () => {
    const { app, query, sor, inbound } = await setup();
    expect((await query('inspection.lot.list', {}, supervisor)).total).toBe(2);
    expect((await query('inspection.code.list', {})).groups.map((g: any) => g.id)).toEqual([
      'SURFACE',
      'VISUAL',
      'defects',
    ]);
    await expect(
      app.invokeRaw(
        { operation: 'inspection.lot.sync', input: { from: 'stale', to: '9', items: [] } },
        integration,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    sor.closeLot('4000002');
    expect(await inbound.runOnce()).toEqual({ batches: 1, items: 1 });
    expect((await query('inspection.lot.get', { id: '4000002' })).status).toBe('closed');
    await expect(
      app.invokeRaw({ operation: 'inspection.lot.sync', input: { to: '1', items: [] } }, inspector),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('plant roles scope lists, reads and events before counting', async () => {
    const { app, query } = await setup();
    const lots = await query('inspection.lot.list', {});
    expect(lots.items.map((lot: any) => lot.id)).toEqual(['4000001', '4000002']);
    await expect(
      app.queryRaw({ operation: 'inspection.lot.get', input: { id: '4000003' } }, inspector),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await query('inspection.lot.list', {}, as('stranger'))).total).toBe(0);
    const resources = (await app.events(0, inspector)).events.map((event) => event.resource);
    expect(resources).toContain('lot:4000001');
    expect(resources).not.toContain('lot:4000003');
    expect((await query('inspection.plant.list', {})).items).toEqual([
      { plant: 'P100', role: 'inspector' },
    ]);
    expect((await query('inspection.plant.list', {}, supervisor)).items[0].members).toMatchObject({
      ina: 'inspector',
      supervisor: 'supervisor',
    });
  });

  test('the worklist gives the next sample and validation reports the offending field', async () => {
    const { command, query, advance, now } = await setup();
    expect(await query('inspection.worklist', { lotId: '4000001' })).toEqual({
      lotId: '4000001',
      next: { characteristicId: 'C10', sample: 1 },
      remaining: 9,
    });
    const first = await command('inspection.result.record', {
      lotId: '4000001',
      station: 'CMM-2',
      ...measure('C10', 220.02),
    });
    expect(first.result).toMatchObject({
      sample: 1,
      evaluation: 'accepted',
      sync: 'pending',
      recordedAt: now(),
      recordedBy: 'ina',
      revision: 1,
    });
    expect(first.effects).toHaveLength(1);
    const outside = await command('inspection.result.record', {
      lotId: '4000001',
      ...measure('C10', 220.31),
    });
    expect(outside.result).toMatchObject({ sample: 2, evaluation: 'rejected' });
    expect((await query('inspection.worklist', { lotId: '4000001' })).next).toEqual({
      characteristicId: 'C10',
      sample: 3,
    });
    const fails = async (input: object, field: string, code = 'INVALID_INPUT') =>
      expect(
        command('inspection.result.record', { lotId: '4000001', ...input }),
      ).rejects.toMatchObject({ code, details: { field } });
    await fails(measure('C10', 220.001), 'value');
    await fails({ characteristicId: 'C40', code: 'XX', occurredAt: T0 }, 'code');
    await fails({ characteristicId: 'C40', value: 1, occurredAt: T0 }, 'code');
    await fails({ ...measure('C10', 220), sample: 1 }, 'sample', 'CONFLICT');
    await fails({ ...measure('C10', 220), sample: 9 }, 'sample');
    await fails(measure('C10', 220, now() - 25 * 3_600_000), 'occurredAt');
    await fails(measure('C10', 220, now() + 10 * 60_000), 'occurredAt');
    await fails(measure('C99', 220), 'characteristicId');
    advance(1);
    const qualitative = await command('inspection.result.record', {
      lotId: '4000001',
      characteristicId: 'C40',
      code: 'POR',
      occurredAt: T0,
    });
    expect(qualitative.result).toMatchObject({ code: 'POR', evaluation: 'rejected' });
  });

  test('a scanner double-send with one idempotency key records one datapoint', async () => {
    const { app, command, query } = await setup();
    const input = { lotId: '4000001', ...measure('C10', 220) };
    const first = await command('inspection.result.record', input, inspector, {
      idempotencyKey: 'capture-form-1',
    });
    const second = await command('inspection.result.record', input, inspector, {
      idempotencyKey: 'capture-form-1',
    });
    expect(second).toEqual(first);
    expect((await query('inspection.lot.get', { id: '4000001' })).recorded).toBe(1);
    expect(await app.pendingEffects(integration)).toHaveLength(1);
  });

  test('a batch commits all measurements or none', async () => {
    const { app, command, query } = await setup();
    await expect(
      command('inspection.result.record-batch', {
        lotId: '4000001',
        results: [measure('C10', 220), measure('C10', 220.001)],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await query('inspection.lot.get', { id: '4000001' })).recorded).toBe(0);
    expect(await app.pendingEffects(integration)).toHaveLength(0);
    const batch = await command('inspection.result.record-batch', {
      lotId: '4000001',
      results: [measure('C10', 220), measure('C10', 220.01), measure('C10', 219.99)],
    });
    expect((batch.result as any).items.map((item: any) => item.sample)).toEqual([1, 2, 3]);
    expect(batch.effects).toHaveLength(3);
  });

  test('roles govern capture, correction and the usage decision', async () => {
    const { command, query } = await setup();
    await expect(
      command('inspection.result.record', { lotId: '4000002', ...measure('C10', 88) }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const mine = await command('inspection.result.record', {
      lotId: '4000002',
      ...measure('C10', 88.5),
    });
    const correct = (resultId: string, context = inspector) =>
      command(
        'inspection.result.correct',
        { resultId, value: 88.005, reason: 'Transposed digits' },
        context,
      );
    await expect(correct((mine.result as any).id, as('ian'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const corrected = await correct((mine.result as any).id);
    expect(corrected.result).toMatchObject({
      sample: 1,
      evaluation: 'accepted',
      supersedes: (mine.result as any).id,
    });
    await expect(correct((mine.result as any).id, supervisor)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      command('inspection.decision.set', { lotId: '4000002', code: 'accept' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      command('inspection.decision.set', { lotId: '4000002', code: 'accept' }, supervisor),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { recorded: 1, required: 6 } });
    const reviewed = await query('inspection.lot.get', { id: '4000002' }, supervisor);
    await command('inspection.result.record-batch', {
      lotId: '4000002',
      results: [
        measure('C10', 88.001),
        measure('C10', 87.999),
        measure('C10', 88),
        measure('C10', 88.01),
        { characteristicId: 'C20', code: 'OK', occurredAt: T0 },
      ],
    });
    // New results after the supervisor's review make the decision stale.
    await expect(
      command('inspection.decision.set', { lotId: '4000002', code: 'accept' }, supervisor, {
        expectedRevisions: { 'lot:4000002': reviewed.revision },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const current = await query('inspection.lot.get', { id: '4000002' }, supervisor);
    const decided = await command(
      'inspection.decision.set',
      { lotId: '4000002', code: 'accept', note: 'All within tolerance' },
      supervisor,
      { expectedRevisions: { 'lot:4000002': current.revision } },
    );
    expect(decided.result).toMatchObject({ decision: { code: 'accept', sync: 'pending' } });
    await expect(
      command('inspection.defect.record', { lotId: '4000002', code: 'D01', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await query('inspection.worklist', { lotId: '4000002' })).remaining).toBe(0);
  });

  test('SoR outcomes return as live business data, and corrections resolve rejections', async () => {
    const { command, query, dispatcher, sor, app } = await setup();
    const accepted = await command('inspection.result.record', {
      lotId: '4000001',
      ...measure('C10', 220),
    });
    expect(await dispatcher.runOnce()).toMatchObject({ accepted: 1 });
    const detail = await query('inspection.lot.get', { id: '4000001' });
    expect(detail.characteristics[0].results[0]).toMatchObject({
      id: (accepted.result as any).id,
      sync: 'accepted',
      sorRef: 'QM-000001',
    });
    sor.lock('4000001');
    const locked = await command('inspection.result.record', {
      lotId: '4000001',
      ...measure('C10', 220.01),
    });
    await command('inspection.defect.record', {
      lotId: '4000001',
      characteristicId: 'C10',
      code: 'D01',
      quantity: 2,
    });
    expect(await dispatcher.runOnce()).toMatchObject({ rejected: 2 });
    const status = await query('inspection.sync.status', {});
    expect(status).toMatchObject({ pending: 0, accepted: 1, rejected: 2, retrying: 0 });
    expect(status.rejections[0]).toMatchObject({
      resource: `result:${(locked.result as any).id}`,
      code: 'LOT_LOCKED',
    });
    sor.lock('4000001', false);
    await command('inspection.result.correct', {
      resultId: (locked.result as any).id,
      value: 220.01,
      reason: 'Resubmit after SoR lock was released',
    });
    await dispatcher.runOnce();
    const resolved = await query('inspection.sync.status', {});
    expect(resolved.rejections.map((entry: any) => entry.resource)).toEqual([
      expect.stringMatching(/^defect:/),
    ]);
    expect([...sor.documents.values()].map((document) => document.type)).toEqual([
      'result.post',
      'result.correct',
    ]);
    // The SoR received the original reference with the correction.
    expect([...sor.documents.values()][1]!.payload).toMatchObject({ value: 220.01 });
    expect(await app.pendingEffects(integration)).toEqual([]);
  });

  test('an unavailable SoR leaves captured data committed and visibly retrying', async () => {
    const { command, query, dispatcher, sor } = await setup();
    await command('inspection.result.record', { lotId: '4000001', ...measure('C10', 220) });
    sor.faults.unavailable = true;
    expect(await dispatcher.runOnce()).toMatchObject({ retried: 1 });
    expect(await query('inspection.sync.status', {})).toMatchObject({
      pending: 1,
      retrying: 1,
      oldestPendingAt: T0,
    });
    expect(await dispatcher.drain(20, 5)).toBe(1);
    sor.faults.unavailable = false;
    expect(await dispatcher.drain(1_000, 5)).toBe(0);
    expect(await query('inspection.sync.status', {})).toMatchObject({ pending: 0, accepted: 1 });
  });

  test('the integration principal cannot capture and operators cannot complete', async () => {
    const { app, command } = await setup();
    await expect(
      app.invokeRaw(
        {
          operation: 'inspection.result.record',
          input: { lotId: '4000001', ...measure('C10', 220) },
        },
        { ...as('integration') },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const recorded = await command('inspection.result.record', {
      lotId: '4000001',
      ...measure('C10', 220),
    });
    await expect(
      command(
        'inspection.effect.complete',
        { effectId: recorded.effects![0], outcome: { status: 'accepted' } },
        supervisor,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      command(
        'inspection.plant.set-member',
        { plant: 'P100', principalId: 'supervisor', role: null },
        supervisor,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('capture metrics split human and agent time-to-commit and SoR acceptance latency', async () => {
    const { command, query, dispatcher, advance } = await setup();
    const agent = {
      ...inspector,
      runId: 'run-1',
      grant: { operations: ['inspection.result.record'], runId: 'run-1' },
    };
    for (const [durationMs, characteristic] of [
      [4_000, 'C10'],
      [6_000, 'C10'],
      [20_000, 'C10'],
    ] as const)
      await command('inspection.result.record', {
        lotId: '4000001',
        ...measure(characteristic, 220),
        capture: { durationMs, input: 'keyboard' },
      });
    const delegated = await command(
      'inspection.result.record',
      {
        lotId: '4000001',
        ...measure('C20', 22.4),
        capture: { durationMs: 300, input: 'instrument' },
      },
      agent,
    );
    expect(delegated.result.capture).toEqual({
      actor: 'agent',
      durationMs: 300,
      input: 'instrument',
    });
    await command(
      'inspection.result.correct',
      { resultId: delegated.result.id, value: 22.04, reason: 'Transposed digits' },
      supervisor,
    );
    advance(2_500);
    await dispatcher.runOnce();
    expect(await query('inspection.metrics.summary', {}, supervisor)).toEqual({
      datapoints: 4,
      human: { count: 3, medianMs: 6_000, p90Ms: 20_000 },
      agent: { count: 1, medianMs: 300, p90Ms: 300 },
      corrections: 1,
      outOfTolerance: 0,
      forwarding: {
        pending: 0,
        rejected: 0,
        accepted: { count: 5, medianMs: 2_500, p90Ms: 2_500 },
      },
    });
    // A viewer at another plant sees nothing; scoping precedes aggregation.
    expect((await query('inspection.metrics.summary', {}, as('stranger'))).datapoints).toBe(0);
  });

  test('a reduced sample plan counts only the samples it still requires', async () => {
    const { command, query, sor, inbound } = await setup();
    const record = (characteristicId: string, sample: number, extra: object = { value: 220 }) =>
      command('inspection.result.record', {
        lotId: '4000001',
        characteristicId,
        sample,
        occurredAt: T0 - 1_000,
        ...extra,
      });
    for (const sample of [1, 2, 3]) {
      await record('C10', sample);
      await record('C20', sample, { value: 22 });
    }
    await record('C30', 2, { value: 0.01 });
    await record('C40', 1, { code: 'OK' });
    // The SoR now requires only RUNOUT sample 1, which nobody measured.
    const lot = demoSeed().lots.find((item) => item.id === '4000001')!;
    sor.publishLot({
      ...lot,
      characteristics: lot.characteristics.map((item) =>
        item.id === 'C30' ? { ...item, sampleSize: 1 } : item,
      ),
    });
    await inbound.runOnce();
    expect(await query('inspection.worklist', { lotId: '4000001' })).toEqual({
      lotId: '4000001',
      next: { characteristicId: 'C30', sample: 1 },
      remaining: 1,
    });
    await expect(
      command('inspection.decision.set', { lotId: '4000001', code: 'accept' }, supervisor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('delivery aggregates apply plant and lot scope to every effect resource', async () => {
    const { command, query, dispatcher, sor } = await setup();
    await command('inspection.defect.record', { lotId: '4000001', code: 'D01', quantity: 1 });
    await command('inspection.result.record', { lotId: '4000001', ...measure('C10', 220) });
    sor.faults.unavailable = true;
    await dispatcher.runOnce();
    // Defect and lot effects resolve to their lot like result effects do.
    expect((await query('inspection.metrics.summary', {}, as('stranger'))).forwarding).toEqual({
      pending: 0,
      rejected: 0,
      accepted: { count: 0 },
    });
    expect((await query('inspection.metrics.summary', {}, supervisor)).forwarding.pending).toBe(2);
    // A delegation limited to another lot sees none of this lot's retry timing.
    const otherLot = {
      ...inspector,
      grant: { operations: ['inspection.sync.status'], resources: ['lot:4000002'] },
    };
    const status = await query('inspection.sync.status', {}, otherLot);
    expect(status).toMatchObject({ pending: 0, retrying: 0 });
    expect(status.oldestPendingAt).toBeUndefined();
    expect(await query('inspection.sync.status', {})).toMatchObject({ pending: 2, retrying: 2 });
  });
});
