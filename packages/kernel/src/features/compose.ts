import type { CapabilityModule } from '@tortoise/contracts';
import {
  featureHandlers,
  routeAuthorization,
  type AuthorizationPort,
  type FeatureComposition,
  type HandlerContribution,
  type RemoteSource,
} from '@tortoise/runtime';
import type { ApplicationConnections, ConnectContext, Observer } from '../application';
import { statefulUnits, type ComposedUnit } from './units';

type Root = Record<string, unknown>;

/** The application's state with a fresh slice per stateful unit, under the unit's id. */
export function composeCreateState(
  create: (localUserId: string) => unknown,
  units: readonly ComposedUnit[],
) {
  return (localUserId: string): Root => {
    const state = create(localUserId) as Root;
    const slices: Root = {};
    for (const unit of statefulUnits(units)) {
      if (Object.hasOwn(state, unit.id))
        throw new Error(
          `Application state already has a "${unit.id}" key; ${unit.kind} slices own it`,
        );
      slices[unit.id] = unit.feature.state!.create(localUserId);
    }
    return { ...state, ...slices };
  };
}

/**
 * Upgrade stored state. The application's upgrade sees the state without unit slices, so it
 * cannot drop or rewrite them; each slice is then kept, upgraded by its unit, or created when
 * the unit is new to this workspace.
 */
export function composeUpgradeState(
  upgrade: ((state: unknown, localUserId: string) => unknown) | undefined,
  units: readonly ComposedUnit[],
) {
  const stateful = statefulUnits(units);
  const keys = new Set(stateful.map((unit) => unit.id));
  return (stored: unknown, localUserId: string): Root => {
    const value = (stored ?? {}) as Root;
    const own = Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
    const state = (upgrade ? upgrade(own, localUserId) : own) as Root;
    const slices: Root = {};
    for (const unit of stateful) {
      const { state: slice } = unit.feature;
      const stored = value[unit.id];
      slices[unit.id] =
        stored === undefined
          ? slice!.create(localUserId)
          : slice!.upgrade
            ? slice!.upgrade(stored, localUserId)
            : stored;
    }
    return { ...state, ...slices };
  };
}

/** What a unit's handler factory sees: the whole manifest, and which modules are the application's. */
export function featureComposition(
  modules: readonly CapabilityModule[],
  units: readonly ComposedUnit[],
): FeatureComposition {
  const owned = new Set(units.flatMap((unit) => unit.feature.manifest.modules));
  return { modules, applicationModules: modules.filter((module) => !owned.has(module)) };
}

/** Unit handlers, each bound to its slice, its access view and its hooks. */
export function composeHandlers(
  handlers: readonly HandlerContribution<any, any>[],
  units: readonly ComposedUnit[],
  composition: FeatureComposition,
): HandlerContribution<any, any>[] {
  return [
    ...handlers,
    ...units.flatMap((unit) =>
      featureHandlers<Root, unknown>(
        {
          key: unit.id,
          feature: unit.feature,
          ...(unit.access ? { access: unit.access } : {}),
          ...(unit.hooks ? { hooks: unit.hooks } : {}),
        },
        composition,
      ),
    ),
  ];
}

/**
 * The application's policy for its own operations and events, each unit's policy for its own
 * with that unit's slice and access view. A unit can neither authorize an application operation
 * nor read an application event, and the application's policy never sees unit operations.
 */
export function composeAuthorization(
  application: AuthorizationPort<any>,
  units: readonly ComposedUnit[],
): AuthorizationPort<Root> {
  return routeAuthorization<Root>(
    application,
    units.flatMap((unit) => {
      const { authorization, manifest } = unit.feature;
      if (!authorization) return [];
      return [
        {
          id: unit.id,
          operations: manifest.modules.flatMap((module) =>
            module.capabilities.map((capability) => capability.id),
          ),
          resourceTypes: authorization.resourceTypes,
          select: (state: Root) => state[unit.id],
          ...(unit.access ? { access: unit.access } : {}),
          port: authorization.port,
        },
      ];
    }),
  );
}

/** Static feature services under each feature's id, after the application's own. */
export function composeServices(services: unknown, units: readonly ComposedUnit[]) {
  const own = units.filter(
    (unit) => unit.kind === 'feature' && unit.feature.services !== undefined,
  );
  if (!own.length) return services;
  return {
    ...(services as object),
    ...Object.fromEntries(own.map((unit) => [unit.id, unit.feature.services])),
  };
}

function mergeSources(
  into: Record<string, RemoteSource>,
  sources: Readonly<Record<string, RemoteSource>> | undefined,
) {
  for (const [target, source] of Object.entries(sources ?? {})) {
    if (Object.hasOwn(into, target)) throw new Error(`Source for "${target}" is declared twice`);
    into[target] = source;
  }
  return into;
}

/** The definition's sources and every unit's static sources, refusing a target named twice. */
export function composeSources(
  sources: Readonly<Record<string, RemoteSource>> | undefined,
  units: readonly ComposedUnit[],
) {
  const merged = mergeSources({}, sources);
  for (const unit of units) mergeSources(merged, unit.feature.sources);
  return Object.keys(merged).length ? merged : undefined;
}

/**
 * The application's connections followed by each unit's: integrations and sources are merged,
 * and observers start in the same order. Undefined when nothing connects.
 */
export function composeConnect(
  connect: ((context: ConnectContext) => ApplicationConnections) | undefined,
  units: readonly ComposedUnit[],
) {
  const parts = [connect, ...units.map((unit) => unit.feature.connect)].filter(
    (part): part is (context: ConnectContext) => ApplicationConnections => part !== undefined,
  );
  if (parts.length <= 1) return parts[0];
  return (context: ConnectContext): ApplicationConnections => {
    const all = parts.map((part) => part(context));
    const observers = all.flatMap((connections) =>
      connections.observe ? [connections.observe] : [],
    );
    const sources: Record<string, RemoteSource> = {};
    for (const connections of all) mergeSources(sources, connections.sources);
    return {
      integrations: all.flatMap((connections) => connections.integrations ?? []),
      ...(Object.keys(sources).length ? { sources } : {}),
      ...(observers.length
        ? {
            observe: async (onError) => {
              const started: Observer[] = [];
              try {
                for (const observe of observers) started.push(...(await observe(onError)));
              } catch (error) {
                // Observers already started would otherwise outlive a failed start.
                await Promise.allSettled(started.map((observer) => observer.stop()));
                throw error;
              }
              return started;
            },
          }
        : {}),
    };
  };
}
