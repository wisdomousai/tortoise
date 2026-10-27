import {
  createApplication,
  createMemoryStorage,
  type CommandReceipt,
  type ExecutionContext,
} from '@agent-native/runtime';
import { createInboundSync } from '@agent-native/integration';
import type { DriverService } from '@agent-native/connector-driver/open';
import {
  createDriverSupervisor,
  type DriverSupervisorOptions,
} from '@agent-native/connector-driver/supervisor';
import { createInstrumentIngest } from '../application';
import { instrumentContract } from '../contracts/instrument';
import { FakeQualitySystem, toSyncInput } from '../fake-sor';
import {
  createQualityHandlers,
  createQualityState,
  qualityInspectionModule,
  qualityPolicy,
} from '../server';

/** A quality application with the demo lots synced, the callers its tests use, and helpers. */
export const T0 = 1_760_000_000_000;
const workspaceId = 'plant-floor';
export const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
const supervisor = as('supervisor');
export const inspector = as('ina');
export const integration = {
  ...as('integration'),
  grant: {
    operations: ['inspection.lot.sync', 'inspection.effect.settle', 'inspection.sync.status'],
  },
};
export const instrument = {
  ...as('instrument'),
  grant: { operations: ['inspection.instrument.ingest'] },
};
export const device = { driver: 'gauge-driver', driverVersion: '1.0.0', serial: 'AD-4410' };

export async function setup() {
  let clock = T0;
  let ids = 0;
  const app = createApplication({
    modules: [qualityInspectionModule],
    handlers: createQualityHandlers(),
    storage: createMemoryStorage(createQualityState({ supervisorId: 'supervisor' })),
    authorization: qualityPolicy,
    services: { newId: () => `id-${++ids}`, now: () => clock },
    now: () => clock,
  });
  const sor = new FakeQualitySystem();
  await createInboundSync({
    application: app,
    port: sor,
    context: integration,
    syncOperation: 'inspection.lot.sync',
    readCursor: async () => undefined,
    toInput: toSyncInput,
  }).runOnce();
  for (const [principalId, role] of [
    ['ina', 'inspector'],
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
    idempotencyKey?: string,
  ): Promise<CommandReceipt<any>> =>
    app.invokeRaw({ operation, input, ...(idempotencyKey ? { idempotencyKey } : {}) }, context);
  const readings = async (context = inspector): Promise<any[]> =>
    (
      (await app.queryRaw({ operation: 'inspection.instrument.readings', input: {} }, context))
        .data as { readings: any[] }
    ).readings;
  let seq = 0;
  /** One reading as the driver ingest sends it; `event` replays an earlier sequence number. */
  const ingest = (value: number, unit = 'mm', event = seq++) =>
    command(
      'inspection.instrument.ingest',
      { session: 's1', seq: event, value, unit, observedAt: clock, device },
      instrument,
      `driver:gauge:s1:${event}`,
    );
  const record = (reading: { id: string; value: number; observedAt: number }, extra = {}) =>
    command('inspection.result.record', {
      lotId: '4000001',
      characteristicId: 'C10',
      value: reading.value,
      occurredAt: reading.observedAt,
      instrumentReading: reading.id,
      ...extra,
    });
  return { app, sor, command, readings, ingest, record, advance: (ms: number) => (clock += ms) };
}

export const until = async (check: () => Promise<boolean>) => {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out');
};

/**
 * The instrument driver behind a supervisor, wired into `app` the way the application wires it:
 * events reach the ingest command as the instrument principal. `start` launches the driver.
 */
export function connectInstrument(
  app: Parameters<typeof createInstrumentIngest>[0]['application'],
  start: DriverSupervisorOptions['start'],
  options: { now?: () => number; healthMs?: number } = {},
) {
  const listeners = new Set<Parameters<DriverService['onEvent']>[1]>();
  const problems: string[] = [];
  const errors: unknown[] = [];
  const supervisor = createDriverSupervisor({
    contract: instrumentContract,
    start,
    healthMs: options.healthMs ?? 0,
    backoff: { minMs: 0, maxMs: 0 },
    onProblem: (problem) => problems.push(problem),
    async onEvent(event, session) {
      for (const listener of listeners) await listener(event, session);
    },
  });
  const ingest = createInstrumentIngest({
    application: app,
    workspaceId,
    service: {
      supervisor: () => supervisor,
      onEvent: (_id, listener) => (listeners.add(listener), () => listeners.delete(listener)),
    },
    ...(options.now ? { now: options.now } : {}),
  });
  ingest.start((error) => errors.push(error));
  return {
    supervisor,
    problems,
    errors,
    async close() {
      await ingest.stop();
      await supervisor.close();
    },
  };
}
