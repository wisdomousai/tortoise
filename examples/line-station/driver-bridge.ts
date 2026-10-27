import type { ExecutionContext, Invocation, QueryResult } from '@agent-native/runtime';
import {
  createEffectDispatcher,
  DeliveryFailure,
  type DispatcherApplication,
} from '@agent-native/integration';
import {
  createDriverConnector,
  createDriverObserver,
  type DriverObservation,
} from '@agent-native/connector-driver/connect';
import type { DriverSupervisor } from '@agent-native/connector-driver/supervisor';
import type { DriverStateField } from '@agent-native/connector-driver/contracts';
import type { BridgeControl } from '@agent-native/screen-bridge';
import { operations } from './contracts';
import { stationAutomationContract } from './contracts/automation';
import { bridgePrincipal, hmiTarget } from './domain';

const contract = stationAutomationContract;
const fields: Readonly<Record<string, DriverStateField>> = contract.state;

/**
 * A station reached through the station automation driver instead of its screen. The driver runs
 * on this host (the station PC) and serves one station, so a host has at most one. It starts only
 * with a site-policy binding for the `station-automation-driver` process.
 */
export interface StationAutomationConfig {
  readonly station: string;
  readonly observeMs?: number;
  readonly deliverMs?: number;
}

export interface LineStationDriverBridgeOptions {
  readonly application: DispatcherApplication & {
    queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
  };
  readonly workspaceId: string;
  readonly station: string;
  /** The station automation driver's supervisor, from the driver plugin's service. */
  readonly supervisor: DriverSupervisor;
  readonly heartbeatMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * A driver observation as `line.observation.ingest` input, the same command the screen observer
 * uses. The contract stands where the screen profile stands; there is no screen. `control` is not
 * a station reading: it becomes `localInput`, set only when local control was observed.
 */
export function automationObservation(station: string) {
  return (observation: DriverObservation) => {
    const control = observation.readings.find((reading) => reading.field === 'control');
    return {
      station,
      profile: { id: contract.id, version: contract.version },
      screen: null,
      observedAt: observation.observedAt,
      frameDigest: observation.frameDigest,
      localInput: control?.status === 'observed' && control.value === 'local',
      readings: observation.readings
        .filter((reading) => reading.field !== 'control')
        .map((reading) => {
          const declared = fields[reading.field]!;
          return {
            field: reading.field,
            value: reading.value,
            confidence: reading.confidence,
            extractor: reading.extractor,
            observedAt: reading.observedAt,
            frameDigest: reading.frameDigest,
            status: reading.status,
            minConfidence: reading.minConfidence,
            declared: {
              type: declared.type,
              ...(declared.options ? { options: [...declared.options] } : {}),
              ...(declared.decimals !== undefined ? { decimals: declared.decimals } : {}),
              ...(declared.unit ? { unit: declared.unit } : {}),
            },
          };
        }),
    };
  };
}

/**
 * One station reached through its automation interface instead of its screen. The observer reports
 * driver state through `line.observation.ingest`, and a dispatcher delivers the station's
 * `legacy-hmi:<station>` effects to the driver and completes them through `line.effect.complete`. It
 * is the screen bridge's twin: the same principal, grant, target, commands and control query, so
 * the domain is the same whichever route a station is configured with.
 *
 * The control query gates every delivery: the bridge mode must allow the action's risk level, and
 * while the operator holds control of the station nothing is sent, as on the screen route.
 */
export function createLineStationDriverBridge(options: LineStationDriverBridgeOptions) {
  const context: ExecutionContext = {
    workspaceId: options.workspaceId,
    principalId: bridgePrincipal(options.station),
    grant: {
      operations: [
        operations.observationIngest.id,
        operations.controlGet.id,
        operations.effectComplete.id,
      ],
    },
  };
  const observer = createDriverObserver({
    contract,
    supervisor: options.supervisor,
    application: options.application,
    context,
    ingestOperation: operations.observationIngest.id,
    toInput: automationObservation(options.station),
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const connector = createDriverConnector({
    target: hmiTarget(options.station),
    contract,
    supervisor: options.supervisor,
    async control() {
      const control = (
        await options.application.queryRaw(
          { operation: operations.controlGet.id, input: { station: options.station } },
          context,
        )
      ).data as BridgeControl;
      // Before anything is read or sent, so the effect stays pending, never held.
      if (control.holder === 'operator') throw new DeliveryFailure('The operator has the station');
      return { mode: control.mode };
    },
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: connector,
    context,
    completeOperation: operations.effectComplete.id,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    context,
    observer,
    connector,
    dispatcher,
    start(observeMs = 1_000, deliverMs = 1_000, onError?: (error: unknown) => void) {
      observer.start(observeMs, onError);
      dispatcher.start(deliverMs);
    },
    async stop() {
      await Promise.all([observer.stop(), dispatcher.stop()]);
    },
  };
}
