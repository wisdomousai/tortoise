import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import type {
  ExecutionContext,
  FeaturePolicy,
  FeatureServer,
  HandlerContext,
  HandlerContribution,
} from '@tortoise/runtime';
import { deviceConfigModule, deviceFeatureManifest, deviceOperations } from './contracts';
import type { ScannerProfile } from './scanner/profile';
import { createScanRouter, type ScanRoute } from './scanner/router';

/** Device configuration state: one entry per station that has any configuration. */
export interface DeviceState {
  stations: Record<string, { scanners: Record<string, ScannerProfile>; routes: ScanRoute[] }>;
}
export function createDeviceState(): DeviceState {
  return { stations: {} };
}

type Context = HandlerContext<DeviceState, unknown>;
const own = <T>(records: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(records, key) ? records[key] : undefined;
function put<T>(records: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(records, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
function stationOf(ctx: Context, station: string) {
  let entry = own(ctx.state.stations, station);
  if (!entry) {
    entry = { scanners: {}, routes: [] };
    put(ctx.state.stations, station, entry);
  }
  return entry;
}
function view(ctx: Context, station: string, changed: boolean) {
  const entry = own(ctx.state.stations, station);
  return {
    station,
    revision: ctx.getRevision(`device:${station}`) + Number(changed),
    scanners: Object.values(entry?.scanners ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1)),
    routes: entry?.routes ?? [],
  };
}
function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, ctx: Context) => OutputOf<C>,
): HandlerContribution<DeviceState, unknown, C> {
  return { capability, handle };
}

export function createDeviceHandlers(): HandlerContribution<DeviceState, unknown>[] {
  return [
    handler(deviceOperations.configGet, (input, ctx) => view(ctx, input.station, false)),
    handler(deviceOperations.scannerSave, (input, ctx) => {
      put(stationOf(ctx, input.station).scanners, input.profile.id, input.profile);
      ctx.change(`device:${input.station}`);
      return view(ctx, input.station, true);
    }),
    handler(deviceOperations.scannerRemove, (input, ctx) => {
      const entry = own(ctx.state.stations, input.station);
      if (!entry || !own(entry.scanners, input.id))
        throw new ApplicationError('NOT_FOUND', 'Scanner profile unavailable');
      delete entry.scanners[input.id];
      ctx.change(`device:${input.station}`);
      return view(ctx, input.station, true);
    }),
    handler(deviceOperations.routesSave, (input, ctx) => {
      try {
        createScanRouter(input.routes);
      } catch (error) {
        throw new ApplicationError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid scan route',
          { field: 'routes' },
        );
      }
      stationOf(ctx, input.station).routes = input.routes;
      ctx.change(`device:${input.station}`);
      return view(ctx, input.station, true);
    }),
  ];
}

const knownOperations = new Set<string>(deviceConfigModule.capabilities.map((item) => item.id));

/** A caller's relation to a station: may read its configuration, or administer it. */
export type DeviceRelation = 'read' | 'administer';

/**
 * The application's decision on who may configure devices where. The application's own policy
 * never sees device operations, so `relation` must apply the application's membership gate and
 * its integration allowlists; the feature applies a delegated grant's resource scope.
 */
export interface DeviceAccess {
  relation(context: ExecutionContext, station: string): DeviceRelation | undefined;
}

/**
 * The device feature's policy. Reads need any relation to the station and writes `administer`; a
 * resource-limited delegation must name `device:<station>`. A command is also checked against
 * the access view of the previous state.
 */
const deviceFeaturePolicy: FeaturePolicy<DeviceState, DeviceAccess> = {
  authorize({ capability, input, context, access, previousAccess, phase }) {
    if (!knownOperations.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    const station = String((input as { station?: unknown }).station ?? '');
    if (context.grant?.resources && !context.grant.resources.includes(`device:${station}`))
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    const permitted = (view: DeviceAccess) => {
      const relation = view.relation(context, station);
      if (!relation) return false;
      return capability.kind === 'query' || phase === 'replay' || relation === 'administer';
    };
    return {
      allowed: permitted(access) && (!previousAccess || permitted(previousAccess)),
      reason: 'RESOURCE_DENIED',
    };
  },
  canReadEvent({ access, context, event }) {
    const station = event.resource.slice(event.resource.indexOf(':') + 1);
    return access.relation(context, station) !== undefined;
  },
};

/**
 * Device configuration as a feature: scanner profiles and scan routes per station, in the
 * `device` slice. The application mounts it with a `DeviceAccess` view built from its own
 * station roles.
 */
export function deviceFeature(): FeatureServer<DeviceState, DeviceAccess> {
  return {
    manifest: deviceFeatureManifest,
    state: { create: createDeviceState },
    handlers: createDeviceHandlers(),
    authorization: { resourceTypes: ['device'], port: deviceFeaturePolicy },
  };
}

export { deviceConfigModule, deviceFeatureManifest, deviceOperations } from './contracts';
