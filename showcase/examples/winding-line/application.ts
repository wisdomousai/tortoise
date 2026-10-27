import {
  approvalFeature,
  authorizationRoute,
  composeAuthorization,
  sliceHandlers,
  type ApprovalAccess,
  type ApprovalHooks,
} from '@agent-native/runtime';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import {
  createDeviceState,
  deviceFeature,
  type DeviceAccess,
  type DeviceState,
} from '@agent-native/devices/server';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import { auditPlugin } from '@agent-native/audit/plugin';
import { lineAutomationPlugin } from './automation';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import type { ProcessPort } from '@agent-native/host/plugin';
import { createDriverPlugin } from '@agent-native/connector-driver/plugin';
import { driverServiceOf } from '@agent-native/connector-driver/open';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { mesTarget } from './contracts';
import { migrations, type LineState } from './domain';
import {
  approvalAccess,
  createLineHandlers,
  createLineState,
  deviceAccess,
  windingLineModule,
  linePolicy,
  type LineServices,
} from './server';
import { FakeMes, toSyncInput, type MesItem } from './fake-mes';
import { startStationBridge, type StationBridgeConfig } from './station-bridge';
import { stationAutomationContract } from './contracts/automation';
import { createWindingLineDriverBridge, type StationAutomationConfig } from './driver-bridge';

/**
 * Workspace state: the line slice. Feature and plugin slices (approval requests, device
 * configuration, the compliance auditors) are added by `defineApplication` under their ids.
 */
export interface WindingLineState {
  windingLine: LineState;
}

/** The homebrew MES integration; separate from every person and every station bridge. */
export const MES_PRINCIPAL = 'mes-integration';

/** The station automation driver, started through the process plugin when bound. */
export const stationAutomationPlugin = createDriverPlugin({
  contracts: [stationAutomationContract],
});

/**
 * Demo only: bridge the simulated winder HMI when `STATION_HMI_URL` names it (start it with
 * `bun run dev:hmi`, or `bun run dev` in this directory). Counters come from
 * `STATION_VISION_BASE_URL` + `STATION_VISION_MODEL` (a local vision model),
 * `STATION_RECOGNITION_WORKER=1` (the `recognition-worker` process the site policy binds), or, with `STATION_SIMULATOR=1` (the HMI is
 * the simulator), from its ground truth; the simulator also reports local input then. Explicit
 * configuration only; a deploying application passes its own station list, and the framework
 * never reads these.
 */
export function demoStations(
  env: Record<string, string | undefined> = process.env,
): StationBridgeConfig[] {
  const hmiUrl = env.STATION_HMI_URL;
  if (!hmiUrl || env.STATION_ROUTE === 'automation') return [];
  const counters: StationBridgeConfig['counters'] =
    env.STATION_VISION_BASE_URL && env.STATION_VISION_MODEL
      ? {
          kind: 'vision',
          baseUrl: env.STATION_VISION_BASE_URL,
          model: env.STATION_VISION_MODEL,
          allowedHosts: (env.STATION_VISION_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
          reads: Number(env.STATION_VISION_READS ?? 3),
        }
      : env.STATION_RECOGNITION_WORKER === '1'
        ? { kind: 'worker' }
        : env.STATION_SIMULATOR === '1'
          ? { kind: 'simulator' }
          : { kind: 'none' };
  return [
    {
      station: env.STATION_ID ?? 'winder-1',
      hmiUrl,
      ...(env.STATION_PROFILE ? { profilePath: env.STATION_PROFILE } : {}),
      localInputProbe: env.STATION_SIMULATOR === '1',
      counters,
      observeMs: Number(env.STATION_OBSERVE_MS ?? 1_000),
    },
  ];
}

/**
 * Demo only: with `STATION_ROUTE=automation`, station `STATION_ID` (default `winder-1`) is reached
 * through the station automation driver instead of its screen. The site policy binds the
 * `station-automation-driver` process, with `STATION_AUTOMATION_SIM_DIR` for the simulated
 * station or `STATION_AUTOMATION_PROGID` for the station software's COM server.
 */
export function demoAutomationStation(
  env: Record<string, string | undefined> = process.env,
): StationAutomationConfig | undefined {
  if (env.STATION_ROUTE !== 'automation') return undefined;
  return {
    station: env.STATION_ID ?? 'winder-1',
    observeMs: Number(env.STATION_OBSERVE_MS ?? 1_000),
  };
}

/** A new workspace's line: one demo station whose creator is its supervisor. */
const freshLine = (ownerId: string) =>
  createLineState({
    mesPrincipalId: MES_PRINCIPAL,
    stations: [
      {
        id: 'winder-1',
        name: 'Winder 1',
        line: 'Winding line 1',
        members: { [ownerId]: 'supervisor' },
      },
    ],
  });

/** The approval and device features, with access from station roles. */
const windingLineFeatures = () => [
  mountFeature<WindingLineState, ApprovalAccess, ApprovalHooks, LineServices>(approvalFeature(), {
    access: (state) => approvalAccess(state.windingLine),
    hooks: {
      newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
      now: (ctx) => (ctx.services.now ?? Date.now)(),
    },
    // Version 1 kept approval requests in the line slice.
    adopt: {
      before: 2,
      from: (stored) => ({
        requests: (stored as { windingLine?: { approvals?: object } }).windingLine?.approvals ?? {},
      }),
    },
  }),
  mountFeature<WindingLineState, DeviceAccess, unknown, LineServices>(deviceFeature(), {
    access: (state) => deviceAccess(state.windingLine),
    // Version 1 kept device configuration at the root under `devices`.
    adopt: {
      before: 2,
      from: (stored) => (stored as { devices?: DeviceState }).devices ?? createDeviceState(),
    },
  }),
];

type BridgeApplication = Parameters<typeof startStationBridge>[0]['application'];

/** Start one bridge per station; if one cannot start, those already running stop first. */
async function startBridges(
  application: BridgeApplication,
  workspaceId: string,
  processes: ProcessPort,
  stations: readonly StationBridgeConfig[],
  onError: (source: string, error: unknown) => void,
) {
  const observers: { stop(): Promise<void> }[] = [];
  try {
    for (const config of stations)
      observers.push(
        await startStationBridge({
          application,
          workspaceId,
          config,
          processes,
          onError: (error) => onError(`Station ${config.station}`, error),
        }),
      );
  } catch (error) {
    // A station that cannot start fails the host; bridges already running stop first.
    await Promise.all(observers.map((observer) => observer.stop()));
    throw error;
  }
  return observers;
}

/**
 * Start the automation route for its station. It was configured explicitly, so a missing process
 * binding refuses the start with the port's reason instead of leaving the station unwatched.
 */
function startAutomation(
  application: BridgeApplication,
  workspaceId: string,
  processes: ProcessPort,
  services: Readonly<Record<string, unknown>>,
  config: StationAutomationConfig,
  onError: (source: string, error: unknown) => void,
) {
  const ready = processes.availability(stationAutomationContract.process.id);
  if (!ready.available) throw new Error(ready.reason);
  const bridge = createWindingLineDriverBridge({
    application,
    workspaceId,
    station: config.station,
    supervisor: driverServiceOf(services).supervisor(stationAutomationContract.id),
  });
  bridge.start(config.observeMs ?? 1_000, config.deliverMs ?? 1_000, (error) =>
    onError(`Station ${config.station}`, error),
  );
  return bridge;
}

/**
 * The winding-line application: stations with approval requests and device configuration. `mes` is the MES port
 * (each instance gets its own in-memory homebrew MES fake without one); `stations` are the
 * station screens a serving host bridges (from the demo environment without them), and
 * `automation` the one station reached through the station automation driver instead. Without
 * either nothing touches any station software.
 */
export function createWindingLineApplication(
  options: {
    mes?: SystemOfRecordPort<MesItem>;
    stations?: readonly StationBridgeConfig[];
    automation?: StationAutomationConfig;
    services?: LineServices;
  } = {},
) {
  return defineApplication<WindingLineState, LineServices>({
    manifest,
    createState: (ownerId) => ({ windingLine: freshLine(ownerId) }),
    migrations,
    upgradeState(state, ownerId) {
      const value = (state ?? {}) as Partial<WindingLineState>;
      return { windingLine: value.windingLine ?? freshLine(ownerId) };
    },
    features: windingLineFeatures(),
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      auditPlugin,
      compliancePlugin,
      lineAutomationPlugin,
      stationAutomationPlugin,
    ],
    handlers: sliceHandlers<WindingLineState, 'windingLine', LineServices>(
      'windingLine',
      createLineHandlers(),
    ),
    authorization: composeAuthorization<WindingLineState>([
      authorizationRoute(
        'windingLine',
        windingLineModule,
        ['station', 'stop', 'count', 'attention', 'order', 'counters', 'sync'],
        linePolicy,
      ),
    ]),
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId, processes, services }) => ({
      integrations: [
        connectTarget<MesItem>({
          target: mesTarget,
          application,
          port: options.mes ?? new FakeMes(),
          workspaceId,
          principalId: MES_PRINCIPAL,
          toInput: toSyncInput,
        }),
      ],
      // Async, so a bad demo environment rejects like a failing bridge instead of throwing.
      observe: async (onError) => {
        const stations = options.stations ?? demoStations();
        const automation = options.automation ?? demoAutomationStation();
        if (!automation)
          return await startBridges(application, workspaceId, processes, stations, onError);
        if (stations.some((config) => config.station === automation.station))
          throw new Error(`Station ${automation.station} is configured on both routes`);
        const driver = startAutomation(
          application,
          workspaceId,
          processes,
          services,
          automation,
          onError,
        );
        try {
          return [
            driver,
            ...(await startBridges(application, workspaceId, processes, stations, onError)),
          ];
        } catch (error) {
          await driver.stop();
          throw error;
        }
      },
    }),
  });
}

export default createWindingLineApplication();
