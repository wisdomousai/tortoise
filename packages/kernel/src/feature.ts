import { ownedName, unitIdPattern } from '@agent-native/contracts';
import type { FeatureServer, HandlerContext } from '@agent-native/runtime';
import type { ApplicationConnections, ConnectContext } from './application';

/**
 * A reusable domain part an application mounts once: modules under one operation namespace, a
 * state slice under the feature's id, handlers, a policy and optional connections. The feature
 * never reads application state; the application supplies an access view and hooks when it
 * mounts it (see `mountFeature`). A host plugin is a feature with ports, a lifecycle and
 * settings.
 *
 * Trust boundary: a feature is trusted code, like the application definition that mounts it.
 */
export interface Feature<
  Slice = any,
  Access = any,
  Hooks = any,
  Services = any,
> extends FeatureServer<Slice, Access, Hooks, Services> {
  /**
   * Targets, observers and remote-query sources, merged with the application's own connections.
   * Target and source names are the feature's id or start with `<id>-`.
   */
  readonly connect?: (context: ConnectContext) => ApplicationConnections;
}

/**
 * Refuse a feature or plugin whose server part cannot be composed: modules without handlers or
 * a policy, or resource types that the unit does not own.
 */
export function checkFeature(
  kind: 'Feature' | 'Plugin',
  feature: Pick<Feature, 'manifest' | 'handlers' | 'authorization' | 'sources'>,
): void {
  const { id, modules } = feature.manifest;
  if (modules.length && !(feature.handlers && feature.authorization))
    throw new Error(`${kind} "${id}" has modules but no handlers or policy`);
  if (kind === 'Plugin') return;
  for (const type of feature.authorization?.resourceTypes ?? [])
    if (!ownedName(id, type))
      throw new Error(
        `Feature "${id}" has resource type "${type}", which is not "${id}" or "${id}-…"`,
      );
  for (const target of Object.keys(feature.sources ?? {}))
    if (!ownedName(id, target))
      throw new Error(
        `Feature "${id}" has a source for "${target}", which is not "${id}" or "${id}-…"`,
      );
}

/** Declare a feature's server part. Fails at definition time; see `checkFeature`. */
export function defineFeature<Slice, Access = undefined, Hooks = {}, Services = unknown>(
  feature: Feature<Slice, Access, Hooks, Services>,
): Feature<Slice, Access, Hooks, Services> {
  if (!unitIdPattern.test(feature.manifest.id))
    throw new Error(`Invalid feature id "${feature.manifest.id}"`);
  checkFeature('Feature', feature);
  return Object.freeze(feature);
}

/**
 * Data a workspace stored before an application version moved it into a feature's slice.
 * Adoption runs once per workspace: for a stored application version below `before` whose state
 * has no slice for the feature yet. The application's own migration step to `before` removes the
 * data, and must not be `compatible`, so code from before the move refuses the workspace instead
 * of reading it without the data.
 */
export interface FeatureAdoption {
  readonly before: number;
  /** The feature slice version `from` produces; the feature's migrations run from there. Default 1. */
  readonly version?: number;
  /** Deterministic. Receives the application's state as stored, before its migrations. */
  from(stored: unknown, ownerId: string): unknown;
}

type HostHooks<Hooks, Root, Services> = {
  readonly [K in keyof Hooks]?: NonNullable<Hooks[K]> extends (...args: infer A) => infer R
    ? (...args: [...A, HandlerContext<Root, Services>]) => R
    : never;
};

/** One feature as an application mounts it. */
export interface FeatureMount<Root = any> {
  readonly feature: Feature;
  readonly access?: (state: Root) => unknown;
  readonly hooks?: Readonly<Record<string, ((...args: never[]) => unknown) | undefined>>;
  readonly adopt?: FeatureAdoption;
}

export interface MountBindings<Root, Access, Hooks, Services> {
  /**
   * The feature's view of the application, computed from the application's state on every
   * authorization and on the first read in a handler. It must replicate the application's own
   * gates (membership, integration lanes, grant scope), because the application's policy never
   * sees the feature's operations.
   */
  readonly access?: (state: Root) => Access;
  /**
   * Host code the feature calls inside a command, with the handler context over the
   * application's state as the last argument. A hook may write application records; they commit
   * with the command, without a policy check of their own.
   */
  readonly hooks?: HostHooks<Hooks, Root, Services>;
  readonly adopt?: FeatureAdoption;
}

/**
 * Mount a feature into an application whose state is `Root`. Static configuration goes into the
 * feature's own factory options; anything that reads the application's state or services goes
 * here.
 */
export function mountFeature<Root, Access, Hooks, Services = unknown>(
  feature: Feature<any, Access, Hooks, any>,
  bindings: MountBindings<Root, Access, Hooks, Services> = {},
): FeatureMount<Root> {
  return Object.freeze({
    feature,
    ...(bindings.access ? { access: bindings.access } : {}),
    ...(bindings.hooks ? { hooks: bindings.hooks as FeatureMount<Root>['hooks'] } : {}),
    ...(bindings.adopt ? { adopt: bindings.adopt } : {}),
  });
}
