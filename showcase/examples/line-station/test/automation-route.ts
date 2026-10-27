import {
  createApplication,
  createMemoryStorage,
  type CommandReceipt,
  type ExecutionContext,
} from '@agent-native/runtime';
import { createInboundSync } from '@agent-native/integration';
import {
  createDriverSupervisor,
  type DriverProcess,
} from '@agent-native/connector-driver/supervisor';
import { stationAutomationContract } from '../contracts/automation';
import { createLineStationDriverBridge } from '../driver-bridge';
import { FakeMes, toSyncInput } from '../fake-mes';
import { createLineHandlers, createLineState, lineStationModule, linePolicy } from '../server';

export const T0 = 1_760_000_000_000;
const workspaceId = 'plant';
export const as = (principalId: string): ExecutionContext => ({ workspaceId, principalId });
export const supervisor = as('sam');
export const operator = as('olga');
const mes = {
  ...as('mes-integration'),
  grant: { operations: ['line.mes.sync', 'line.sync.status', 'line.effect.settle'] },
};

/**
 * One station, `line-1`, on the automation route: the line application with its MES orders
 * synced, and the driver bridge over a real supervisor for the driver `start` launches. The
 * clock moves only when the test observes or the connector waits for a readback.
 */
export async function automationRoute(options: {
  start: () => Promise<DriverProcess>;
  /** Puts the machine in STOPPED, so a recipe may be loaded. */
  stopMachine: () => void | Promise<void>;
}) {
  let clock = T0;
  let ids = 0;
  let effects = 0;
  const app = createApplication({
    modules: [lineStationModule],
    handlers: createLineHandlers(),
    storage: createMemoryStorage(
      createLineState({
        stations: [
          {
            id: 'line-1',
            name: 'Filler 1',
            line: 'Line 1',
            members: { sam: 'supervisor', olga: 'operator' },
          },
        ],
      }),
    ),
    authorization: linePolicy,
    services: { newId: () => `id-${++ids}`, now: () => clock },
    newEffectId: () => `effect-${++effects}`,
    now: () => clock,
  });
  const driver = createDriverSupervisor({
    contract: stationAutomationContract,
    start: options.start,
    backoff: { minMs: 0, maxMs: 0 },
    healthMs: 0,
  });
  const bridge = createLineStationDriverBridge({
    application: app,
    workspaceId,
    station: 'line-1',
    supervisor: driver,
    pollMs: 1,
    now: () => clock,
    sleep: async () => {
      clock += 100;
    },
  });
  const inbound = createInboundSync({
    application: app,
    port: new FakeMes(),
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
  await inbound.runOnce();
  const command = (
    operation: string,
    input: unknown,
    context = operator,
  ): Promise<CommandReceipt<any>> => app.invokeRaw({ operation, input }, context);
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
  /** A stopped machine, the bridge allowed to act, and the agent holding the station seat. */
  const ready = async () => {
    await options.stopMachine();
    await observe();
    await command('line.bridge.set-mode', { station: 'line-1', mode: 'actuate' }, supervisor);
    await command('line.seat.request', { station: 'line-1', seat: 'agent' });
  };
  return { command, query, observe, deliver, ready, close: () => driver.close() };
}
