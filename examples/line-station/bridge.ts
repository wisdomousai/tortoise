import { readFileSync } from 'node:fs';
import type { ExecutionContext, Invocation, QueryResult } from '@agent-native/runtime';
import { createEffectDispatcher, type DispatcherApplication } from '@agent-native/integration';
import {
  createScriptedDriver,
  createStationConnector,
  createStationObserver,
  parseProfile,
  type BridgeControl,
  type ComputerUseDriver,
  type Extractor,
  type ScreenTransport,
  type StationProfile,
} from '@agent-native/station';
import { operations } from './contracts';
import { bridgePrincipal, hmiTarget } from './domain';
// Imported, not read from disk: compiled binaries embed JSON imports but contain no source files.
import fillerProfile from './station-profile.json';

/** Read and validate a station profile document; throws listing every issue. */
export function loadProfile(path: string | URL): StationProfile {
  return parseProfile(JSON.parse(readFileSync(path, 'utf8')));
}
/** The reference station profile shipped with the example. */
export const filler: StationProfile = parseProfile(fillerProfile);

export interface LineStationBridgeOptions {
  readonly application: DispatcherApplication & {
    queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
  };
  readonly workspaceId: string;
  readonly station: string;
  readonly transport: ScreenTransport;
  readonly extractors: readonly Extractor[];
  readonly profile?: StationProfile;
  /** Scripted by default; a computer-use driver only proposes targets and passes the same gate. */
  readonly driver?: ComputerUseDriver;
  readonly heartbeatMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * One station's bridge: the observer reports the screen through `line.observation.ingest`, and
 * a dispatcher delivers `legacy-hmi:<station>` effects through the gated screen connector and
 * settles them through `line.effect.settle`. Both run as the station's bridge principal with a
 * grant limited to those operations and the control query, so a compromised transport, model or
 * driver cannot start orders, classify stops or verify readings.
 */
export function createLineStationBridge(options: LineStationBridgeOptions) {
  const context: ExecutionContext = {
    workspaceId: options.workspaceId,
    principalId: bridgePrincipal(options.station),
    grant: {
      operations: [
        operations.observationIngest.id,
        operations.controlGet.id,
        operations.effectSettle.id,
      ],
    },
  };
  const profile = options.profile ?? filler;
  const observer = createStationObserver({
    station: options.station,
    profile,
    transport: options.transport,
    extractors: options.extractors,
    application: options.application,
    context,
    ingestOperation: operations.observationIngest.id,
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  const connector = createStationConnector({
    target: hmiTarget(options.station),
    profile,
    transport: options.transport,
    extractors: options.extractors,
    driver: options.driver ?? createScriptedDriver(),
    // Read before the first and every following action, so a takeover or mode change applies
    // between two screen actions, not after the procedure.
    control: async () =>
      (
        await options.application.queryRaw(
          { operation: operations.controlGet.id, input: { station: options.station } },
          context,
        )
      ).data as BridgeControl,
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const dispatcher = createEffectDispatcher({
    application: options.application,
    port: connector,
    context,
    settleOperation: operations.effectSettle.id,
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
