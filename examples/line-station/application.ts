import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import {
  createDeviceHandlers,
  createDeviceState,
  deviceAuthorizationRoute,
  type DeviceState,
} from '@agent-native/devices/server';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { lineAutomationPlugin } from './automation';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import type { ProcessPort } from '@agent-native/host/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { mesTarget } from './contracts';
import { stationRole, type LineState } from './domain';
import {
  createLineHandlers,
  createLineState,
  lineStationModule,
  linePolicy,
  type LineServices,
} from './server';
import { FakeMes, toSyncInput, type MesItem } from './fake-mes';
import { startStationBridge, type StationBridgeConfig } from './station-bridge';

export interface LineStationState {
  lineStation: LineState;
  devices: DeviceState;
}

/** The homebrew MES integration; separate from every person and every station bridge. */
export const MES_PRINCIPAL = 'mes-integration';

/**
 * Demo only: bridge the simulated filler HMI when `STATION_HMI_URL` names it (start it with
 * `bun run dev:hmi`, or `bun run dev` in this directory). Counters come from
 * `STATION_VISION_BASE_URL` + `STATION_VISION_MODEL` (a local vision model),
 * `STATION_PERCEPTION_WORKER=1` (the `perception-worker` process the site policy binds), or, with `STATION_SIMULATOR=1` (the HMI is
 * the simulator), from its ground truth; the simulator also reports local input then. Explicit
 * configuration only; a deploying application passes its own station list, and the framework
 * never reads these.
 */
export function demoStations(
  env: Record<string, string | undefined> = process.env,
): StationBridgeConfig[] {
  const hmiUrl = env.STATION_HMI_URL;
  if (!hmiUrl) return [];
  const counters: StationBridgeConfig['counters'] =
    env.STATION_VISION_BASE_URL && env.STATION_VISION_MODEL
      ? {
          kind: 'vision',
          baseUrl: env.STATION_VISION_BASE_URL,
          model: env.STATION_VISION_MODEL,
          allowedHosts: (env.STATION_VISION_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
          reads: Number(env.STATION_VISION_READS ?? 3),
        }
      : env.STATION_PERCEPTION_WORKER === '1'
        ? { kind: 'worker' }
        : env.STATION_SIMULATOR === '1'
          ? { kind: 'simulator' }
          : { kind: 'none' };
  return [
    {
      station: env.STATION_ID ?? 'line-1',
      hmiUrl,
      ...(env.STATION_PROFILE ? { profilePath: env.STATION_PROFILE } : {}),
      localInputProbe: env.STATION_SIMULATOR === '1',
      counters,
      observeMs: Number(env.STATION_OBSERVE_MS ?? 1_000),
    },
  ];
}

/** A new workspace's line: one demo station whose creator is its supervisor. */
const freshLine = (ownerId: string) =>
  createLineState({
    mesPrincipalId: MES_PRINCIPAL,
    stations: [
      { id: 'line-1', name: 'Filler 1', line: 'Line 1', members: { [ownerId]: 'supervisor' } },
    ],
  });

/** Line and device handlers, each over its own slice of the state. */
const lineStationHandlers = () => [
  ...sliceHandlers<LineStationState, 'lineStation', LineServices>(
    'lineStation',
    createLineHandlers(),
  ),
  ...sliceHandlers<LineStationState, 'devices', LineServices>('devices', createDeviceHandlers()),
];

/** Line policy for line resources, station roles for devices. */
const lineStationAuthorization = () =>
  composeAuthorization<LineStationState>([
    authorizationRoute(
      'lineStation',
      lineStationModule,
      ['station', 'stop', 'count', 'attention', 'order', 'counters', 'sync', 'proposal'],
      linePolicy,
    ),
    // Device configuration follows station roles: supervisors administer, everyone else reads.
    deviceAuthorizationRoute<LineStationState>((state) => ({
      config: state.devices,
      access(principalId, station) {
        const role = stationRole(state.lineStation, principalId, station);
        return role === 'supervisor' ? 'administer' : role ? 'read' : undefined;
      },
    })),
  ]);

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
 * The line-station application: stations with device configuration. `mes` is the MES port
 * (each authority gets its own in-memory homebrew MES fake without one); `stations` are the
 * station screens a serving host bridges (from the demo environment without them). Without
 * stations nothing touches any station software.
 */
export function createLineStationApplication(
  options: {
    mes?: SystemOfRecordPort<MesItem>;
    stations?: readonly StationBridgeConfig[];
    services?: LineServices;
  } = {},
) {
  return defineApplication<LineStationState, LineServices>({
    manifest,
    createState: (ownerId) => ({
      lineStation: freshLine(ownerId),
      devices: createDeviceState(),
    }),
    upgradeState(state, ownerId) {
      const value = (state ?? {}) as Partial<LineStationState>;
      return {
        // Workspaces from before proposals get an empty proposal slice.
        lineStation: value.lineStation
          ? { ...value.lineStation, proposals: value.lineStation.proposals ?? {} }
          : freshLine(ownerId),
        devices: value.devices ?? createDeviceState(),
      };
    },
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      auditPlugin,
      compliancePlugin,
      lineAutomationPlugin,
    ],
    handlers: lineStationHandlers(),
    authorization: lineStationAuthorization(),
    ...(options.services ? { services: options.services } : {}),
    connect: ({ application, workspaceId, processes }) => ({
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
      observe: async (onError) =>
        await startBridges(
          application,
          workspaceId,
          processes,
          options.stations ?? demoStations(),
          onError,
        ),
    }),
  });
}

export default createLineStationApplication();
