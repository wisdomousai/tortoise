import { describe, expect, test } from 'bun:test';
import {
  createApplication,
  createMemoryStorage,
  type CommandReceipt,
  type ExecutionContext,
} from '@agent-native/runtime';
import { createEffectDispatcher, createInboundSync } from '@agent-native/integration';
import { createAccessibilityExtractor } from '@agent-native/screen-bridge';
import { createWindingLineBridge } from './bridge';
import { FakeMes, toSyncInput } from './fake-mes';
import { createSimulatorOcr, createSimulatorTransport } from './fake-hmi/memory';
import { HmiSimulator } from './fake-hmi/simulator';
import { createLineHandlers, createLineState, windingLineModule, linePolicy } from './server';

const T0 = 1_760_000_000_000;
const workspaceId = 'plant';
const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
const supervisor = as('sam');
const operator = as('olga');
const viewer = as('vic');
const mes = {
  ...as('mes-integration'),
  grant: { operations: ['line.mes.sync', 'line.sync.status', 'line.effect.complete'] },
};

async function setup() {
  let clock = T0;
  let ids = 0;
  let effects = 0;
  const app = createApplication({
    modules: [windingLineModule],
    handlers: createLineHandlers(),
    storage: createMemoryStorage(
      createLineState({
        stations: [
          {
            id: 'winder-1',
            name: 'Winder 1',
            line: 'Winding line 1',
            members: { sam: 'supervisor', olga: 'operator', vic: 'viewer' },
          },
          {
            id: 'winder-2',
            name: 'Winder 2',
            line: 'Winding line 2',
            members: { sam: 'supervisor' },
          },
        ],
      }),
    ),
    authorization: linePolicy,
    services: { newId: () => `id-${++ids}`, now: () => clock },
    newEffectId: () => `effect-${++effects}`,
    now: () => clock,
  });
  const sim = new HmiSimulator(() => clock);
  const ocr = { confidence: 0.98 } as { confidence: number; misread?: number };
  const bridge = createWindingLineBridge({
    application: app,
    workspaceId,
    station: 'winder-1',
    transport: createSimulatorTransport(sim, () => clock),
    extractors: [createAccessibilityExtractor(), createSimulatorOcr(() => sim.state, ocr)],
    now: () => clock,
    sleep: async () => {
      clock += 100;
    },
  });
  const fakeMes = new FakeMes();
  const inbound = createInboundSync({
    application: app,
    port: fakeMes,
    context: mes,
    syncOperation: 'line.mes.sync',
    readCursor: async () =>
      (
        (await app.queryRaw({ operation: 'line.sync.status', input: {} }, mes)).data as {
          watermark?: string;
        }
      ).watermark,
    toInput: toSyncInput,
  });
  const mesDispatcher = createEffectDispatcher({
    application: app,
    port: fakeMes,
    context: mes,
    completeOperation: 'line.effect.complete',
    now: () => clock,
  });
  await inbound.runOnce();
  const command = (
    operation: string,
    input: unknown,
    context = operator,
    extra = {},
  ): Promise<CommandReceipt<any>> => app.invokeRaw({ operation, input, ...extra }, context);
  const query = async (operation: string, input: unknown, context = operator): Promise<any> =>
    (await app.queryRaw({ operation, input }, context)).data;
  /** Observe until state-field stability (two agreeing reads) is reached. */
  const observe = async (passes = 2) => {
    for (let pass = 0; pass < passes; pass++) {
      clock += 1_000;
      await bridge.observer.runOnce();
    }
  };
  const deliver = () => bridge.dispatcher.runOnce(undefined, { ignoreBackoff: true });
  return {
    app,
    sim,
    ocr,
    bridge,
    fakeMes,
    mesDispatcher,
    command,
    query,
    observe,
    deliver,
    advance: (ms: number) => (clock += ms),
  };
}

/** Prepare winder-1 for actuation: machine stopped, bridge allowed to act, agent holding control. */
async function ready(env: Awaited<ReturnType<typeof setup>>) {
  env.sim.stopMachine();
  await env.observe();
  await env.command('line.bridge.set-mode', { station: 'winder-1', mode: 'actuate' }, supervisor);
  await env.command('line.control.request', { station: 'winder-1', holder: 'agent' });
}

describe('winding line: observe, annotate, actuate', () => {
  test('the bridge reports what the screen shows with provenance; stops open and close', async () => {
    const { sim, observe, query } = await setup();
    await observe();
    let station = await query('line.station.get', { station: 'winder-1' });
    expect(station.readings.machine).toMatchObject({
      value: 'RUNNING',
      source: 'accessibility',
      status: 'observed',
      stale: false,
    });
    expect(station.readings.good).toMatchObject({
      value: sim.state.good,
      source: 'counter-ocr',
      model: { id: 'simulator-ocr', version: '1' },
      confidence: 0.98,
    });
    expect(station.bridge).toMatchObject({
      screen: 'main',
      mode: 'monitor-only',
      controlHolder: 'idle',
      profile: { id: 'winder-hmi' },
    });

    sim.raiseAlarm('E-214 Wire break at tensioner');
    await observe();
    station = await query('line.station.get', { station: 'winder-1' });
    expect(station.currentStop).toMatchObject({
      state: 'ALARM',
      alarm: 'E-214 Wire break at tensioner',
    });
    expect(station.openStop).toBe(true);

    sim.startMachine();
    await observe();
    const stops = await query('line.stop.list', { station: 'winder-1' });
    expect(stops.items).toHaveLength(1);
    expect(stops.items[0].endedAt).toBeGreaterThan(stops.items[0].startedAt);
  });

  test('a stop classified at the station is forwarded to the non-idempotent MES exactly once', async () => {
    const { sim, observe, query, command, mesDispatcher, fakeMes } = await setup();
    await observe();
    sim.stopMachine();
    await observe();
    const [stop] = (await query('line.stop.list', { station: 'winder-1', unclassified: true }))
      .items;
    await expect(
      command('line.stop.classify', { stopId: stop.id, reason: 'NOPE' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      command('line.stop.classify', { stopId: stop.id, reason: 'WIRE' }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await command('line.stop.classify', { stopId: stop.id, reason: 'WIRE' });

    // The MES books it but the response is lost; the next pass finds the booking instead of booking twice.
    fakeMes.faults.loseNextResponse = true;
    expect(await mesDispatcher.runOnce()).toMatchObject({ retried: 1 });
    expect(await mesDispatcher.runOnce(undefined, { ignoreBackoff: true })).toMatchObject({
      accepted: 1,
    });
    expect(fakeMes.bookings).toHaveLength(1);
    expect((await query('line.stop.list', { station: 'winder-1' })).items[0]).toMatchObject({
      reason: 'WIRE',
      sync: 'accepted',
      sorRef: 'MES-00001',
      classifiedBy: 'olga',
    });
    await expect(
      command('line.stop.classify', { stopId: stop.id, reason: 'MAT' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('starting an order loads the recipe through the screen, accepted by readback', async () => {
    const env = await setup();
    const { sim, observe, query, command, deliver } = env;
    await observe();
    await expect(
      command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('RUNNING'),
    });
    // An agent cannot stand in for the person whose presence the procedure requires.
    await expect(
      command(
        'line.order.start',
        { station: 'winder-1', orderId: 'ORD-7002' },
        { ...operator, runId: 'run-1', grant: { operations: ['line.order.start'] } },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ready(env);
    const started = await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    expect(started.result.desired).toMatchObject({
      recipe: 'R-100',
      sync: 'pending',
      converged: false,
    });

    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect(sim.state.recipe).toBe('R-100');
    expect(sim.state).toMatchObject({ estopResets: 0, jogs: 0, machine: 'STOPPED' });
    await observe(1);
    const station = await query('line.station.get', { station: 'winder-1' });
    expect(station.desired).toMatchObject({ sync: 'accepted', converged: true });
    expect(station.order).toMatchObject({ id: 'ORD-7002', status: 'active' });
    // Loading the next order completes the one the station leaves, with its own journal entry.
    const { cursor } = await env.app.events(0, supervisor);
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7001' });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    const changed = (await env.app.events(cursor, supervisor)).events.map((e) => e.resource);
    expect(changed).toContain('order:ORD-7002');
    expect((await query('line.station.get', { station: 'winder-1' })).order.id).toBe('ORD-7001');
  });

  test('monitor-only and operator control keep effects pending without touching the screen', async () => {
    const env = await setup();
    const { sim, command, deliver, query } = env;
    await ready(env);
    await command(
      'line.bridge.set-mode',
      { station: 'winder-1', mode: 'monitor-only' },
      supervisor,
    );
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    expect(await deliver()).toMatchObject({ retried: 1, accepted: 0 });
    await command('line.bridge.set-mode', { station: 'winder-1', mode: 'actuate' }, supervisor);
    await command('line.control.request', { station: 'winder-1', holder: 'operator' });
    expect(await deliver()).toMatchObject({ retried: 1, held: 0 });
    expect(sim.state.screen).toBe('main');
    expect(sim.state.recipe).toBe('R-250');
    // Blocked attempts never touched the screen, so handing back delivers instead of holding.
    await command('line.control.request', { station: 'winder-1', holder: 'agent' });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect((await query('line.sync.status', {})).targets).toContainEqual(
      expect.objectContaining({ target: 'legacy-hmi:winder-1', accepted: 1, held: 0 }),
    );
  });

  test('a vendor popup mid-procedure holds the effect until a person reconciles it', async () => {
    const env = await setup();
    const { sim, command, deliver, query } = env;
    await ready(env);
    const { result } = await command('line.order.start', {
      station: 'winder-1',
      orderId: 'ORD-7002',
    });
    sim.showPopup(1);
    expect(await deliver()).toMatchObject({ held: 1 });
    const [item] = (await query('line.attention.list', { station: 'winder-1' })).items;
    expect(item).toMatchObject({
      kind: 'reconcile',
      effectId: 'effect-1',
      detail: 'Timed out waiting at step 2 of 6; the station shows an unknown screen',
    });
    expect((await query('line.station.get', { station: 'winder-1' })).desired).toMatchObject({
      sync: 'held',
    });
    await expect(
      command('line.order.start', { station: 'winder-1', orderId: 'ORD-7001' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // Held: never redelivered on its own.
    expect(await deliver()).toMatchObject({ accepted: 0, held: 0 });

    await expect(
      command('line.effect.reconcile', { effectId: item.effectId, applied: false }, viewer),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    sim.press('popupOk');
    await command('line.effect.reconcile', { effectId: item.effectId, applied: false });
    expect(await deliver()).toMatchObject({ accepted: 1 });
    expect(sim.state.recipe).toBe('R-100');
    expect(result.desired.recipe).toBe('R-100');
  });

  test('taking over the screen mid-procedure stops the bridge before its next action', async () => {
    const env = await setup();
    const { sim, command, deliver, query, bridge } = env;
    await ready(env);
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    // The operator taps "Take over" right after the bridge opened the dialog.
    const press = sim.press.bind(sim);
    sim.press = (control) => {
      press(control);
      if (control === 'load')
        void command('line.control.request', { station: 'winder-1', holder: 'operator' });
    };
    expect(await deliver()).toMatchObject({ held: 1 });
    expect(sim.state.screen).toBe('recipe');
    expect(sim.state.draft).toBe('');
    const [item] = (await query('line.attention.list', { station: 'winder-1' })).items;
    expect(item.detail).toBe('The operator has the station');
    // The operator finishes the dialog by hand and says it was applied.
    sim.setDraft('R-100');
    sim.press('confirm');
    await command('line.effect.reconcile', { effectId: item.effectId, applied: true });
    const station = await query('line.station.get', { station: 'winder-1' });
    expect(station.desired).toMatchObject({ sync: 'accepted' });
    expect(station.order).toMatchObject({ id: 'ORD-7002', status: 'active' });
    expect(bridge.context.principalId).toBe('station-bridge:winder-1');
  });

  test('unsure counter reads ask a person; confirmed counts go to the MES', async () => {
    const env = await setup();
    const { sim, ocr, observe, command, query, deliver, mesDispatcher, fakeMes } = env;
    await ready(env);
    await command('line.order.start', { station: 'winder-1', orderId: 'ORD-7002' });
    await deliver();
    ocr.confidence = 0.6;
    sim.state.good = 5000;
    await observe(1);
    const [item] = (await query('line.attention.list', { station: 'winder-1' })).items;
    expect(item).toMatchObject({
      kind: 'reading',
      field: 'good',
      proposed: 5000,
      confidence: 0.6,
      source: 'counter-ocr',
    });
    // The earlier confident value stays; the unsure one is a question, not a fact.
    expect((await query('line.station.get', { station: 'winder-1' })).readings.good.value).toBe(
      4210,
    );

    await expect(
      command('line.reading.confirm', { attentionId: item.id, value: '5000' }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await command('line.reading.confirm', { attentionId: item.id, value: 5001 });
    const station = await query('line.station.get', { station: 'winder-1' });
    expect(station.readings.good).toMatchObject({
      value: 5001,
      status: 'operator-verified',
      verifiedBy: 'olga',
    });
    expect((await query('line.attention.list', { station: 'winder-1' })).items).toHaveLength(0);

    // Counts that changed after the operator looked conflict instead of being sent.
    const looked = station.countersRevision;
    ocr.confidence = 0.98;
    sim.state.scrap = 40;
    await observe(1);
    await expect(
      command('line.count.confirm', { station: 'winder-1' }, operator, {
        expectedRevisions: { 'counters:winder-1': looked },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const fresh = (await query('line.station.get', { station: 'winder-1' })).countersRevision;
    const { result } = await command('line.count.confirm', { station: 'winder-1' }, operator, {
      expectedRevisions: { 'counters:winder-1': fresh },
    });
    expect(result).toMatchObject({ orderId: 'ORD-7002', scrap: 40, sync: 'pending' });
    expect(await mesDispatcher.runOnce()).toMatchObject({ accepted: 1 });
    expect(fakeMes.bookings.at(-1)).toMatchObject({
      type: 'count.post',
      payload: { order: 'ORD-7002', scrap: 40 },
    });

    // Stale observations cannot be confirmed.
    env.advance(60_000);
    await expect(command('line.count.confirm', { station: 'winder-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  test('readings keep their frame and profile; corrections follow the declared field type', async () => {
    const env = await setup();
    const { observe, command, query } = env;
    await observe();
    const station = await query('line.station.get', { station: 'winder-1' });
    expect(station.readings.machine).toMatchObject({
      frameDigest: expect.any(String),
      profile: { id: 'winder-hmi' },
    });
    // An unsure textual reading, as a vision model might report a recipe label.
    const bridgeContext = {
      ...as('station-bridge:winder-1'),
      grant: { operations: ['line.observation.ingest'] },
    };
    const uncertain = (field: string, value: string, declared: object) => ({
      field,
      value,
      confidence: 0.5,
      extractor: 'vision',
      observedAt: T0 + 60_000,
      frameDigest: `frame-${field}`,
      status: 'uncertain',
      minConfidence: 0.9,
      declared,
    });
    await command(
      'line.observation.ingest',
      {
        station: 'winder-1',
        profile: { id: 'winder-hmi', version: '1.0.0' },
        screen: 'main',
        observedAt: T0 + 60_000,
        frameDigest: 'frame-text',
        localInput: false,
        readings: [
          uncertain('recipe', 'RC-0B', { type: 'text' }),
          uncertain('machine', 'RUNNlNG', {
            type: 'enum',
            options: ['RUNNING', 'STOPPED', 'ALARM'],
          }),
        ],
      },
      bridgeContext,
    );
    const items = (await query('line.attention.list', { station: 'winder-1' })).items;
    const recipe = items.find((item: { field?: string }) => item.field === 'recipe');
    const machine = items.find((item: { field?: string }) => item.field === 'machine');
    expect(recipe).toMatchObject({
      value: { type: 'text' },
      frameDigest: 'frame-recipe',
      profile: { id: 'winder-hmi', version: '1.0.0' },
    });
    expect(machine.value).toEqual({ type: 'enum', options: ['RUNNING', 'STOPPED', 'ALARM'] });
    for (const value of [42, '  ', true])
      await expect(
        command('line.reading.confirm', { attentionId: recipe.id, value }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await command('line.reading.confirm', { attentionId: recipe.id, value: 'RC-08' });
    await expect(
      command('line.reading.confirm', { attentionId: machine.id, value: 'RUNNlNG' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await command('line.reading.confirm', { attentionId: machine.id, value: 'RUNNING' });
    const readings = (await query('line.station.get', { station: 'winder-1' })).readings;
    expect(readings.recipe).toMatchObject({ value: 'RC-08', status: 'operator-verified' });
    expect(readings.machine).toMatchObject({ value: 'RUNNING', status: 'operator-verified' });
  });

  test('integration principals call only their allowlists', async () => {
    const env = await setup();
    const { app, command, observe, bridge, mesDispatcher } = env;
    await observe();
    const ingest = (station: string, context: ExecutionContext) =>
      app.invokeRaw(
        {
          operation: 'line.observation.ingest',
          input: {
            station,
            profile: { id: 'x', version: '1' },
            screen: 'main',
            observedAt: T0 + 1e7,
            frameDigest: 'd',
            localInput: false,
            readings: [],
          },
        },
        context,
      );
    await expect(ingest('winder-2', bridge.context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ingest('winder-1', operator)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.queryRaw(
        { operation: 'line.stop.list', input: { station: 'winder-1' } },
        as('station-bridge:winder-1'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invokeRaw(
        { operation: 'line.control.request', input: { station: 'winder-1', holder: 'operator' } },
        as('mes-integration'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // The MES cannot complete a screen procedure, and the bridge cannot complete an MES record.
    await ready(env);
    const { result } = await command('line.order.start', {
      station: 'winder-1',
      orderId: 'ORD-7002',
    });
    const effectId = (
      await app.pendingEffects(bridge.context, { target: 'legacy-hmi:winder-1' })
    )[0]!.id;
    const complete = (context: ExecutionContext) =>
      app.invokeRaw(
        { operation: 'line.effect.complete', input: { effectId, outcome: { status: 'accepted' } } },
        context,
      );
    await expect(complete(as('mes-integration'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(complete(as('station-bridge:winder-2'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(result.desired.sync).toBe('pending');
    expect(await mesDispatcher.runOnce()).toMatchObject({ accepted: 0 });
  });
});
