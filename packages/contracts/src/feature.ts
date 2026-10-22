import type { CapabilityModule } from './capability';
import type { HostComponent } from './requirements';

/**
 * The browser-safe part of a feature: a reusable domain part, such as approval requests, that an
 * application mounts once. Its id is its state key, its services key and the namespace of its
 * operations, so every operation of a feature starts with `<id>.`. Applications list it in
 * `defineManifest({ features })`, which merges its modules and components into the manifest the
 * way it merges a host plugin's. Pure data, no host code.
 */
export interface FeatureManifest<
  Modules extends readonly CapabilityModule[] = readonly CapabilityModule[],
> {
  /** Lowercase id: state key, `feature:<id>` stamp, services key and operation namespace. */
  readonly id: string;
  readonly title: string;
  readonly modules: Modules;
  /** Network destinations, devices and processes the feature itself needs. */
  readonly components?: readonly HostComponent[];
  /** Features that must be mounted before this one. */
  readonly requires?: readonly string[];
}

/** Lowercase, hyphen-separated: the pattern of application, feature and plugin ids. */
export const unitIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The text before an operation id's first `.`: `approval` for `approval.request`. */
export const operationNamespace = (operationId: string): string => {
  const dot = operationId.indexOf('.');
  return dot < 0 ? operationId : operationId.slice(0, dot);
};

/** Whether `name` is `id` itself or starts with `id-`, as a feature's module and target names do. */
export const ownedName = (id: string, name: string): boolean =>
  name === id || name.startsWith(`${id}-`);

/**
 * Refuse an operation outside `namespace`. Shared by features and host plugins, whose namespace
 * is their id unless a plugin keeps a wire-stable one.
 */
export function checkNamespace(
  unit: string,
  namespace: string,
  modules: readonly CapabilityModule[],
): void {
  if (!unitIdPattern.test(namespace))
    throw new Error(`"${unit}" has an invalid operation namespace "${namespace}"`);
  for (const module of modules)
    for (const capability of module.capabilities)
      if (operationNamespace(capability.id) !== namespace || !capability.id.includes('.'))
        throw new Error(
          `"${unit}" declares ${capability.id}, which is outside its namespace "${namespace}."`,
        );
}

/**
 * Declare a feature manifest. Fails at definition time on an invalid id, an operation whose
 * namespace is not `id`, a module id other than `id` or `id-…`, and an outbox or remote-read
 * target other than `id` or `id-…`, so two features cannot claim the same names.
 */
export function defineFeatureManifest<
  const Modules extends readonly CapabilityModule[] = readonly [],
>(
  manifest: Omit<FeatureManifest<Modules>, 'modules'> & { readonly modules?: Modules },
): FeatureManifest<Modules> {
  const { id } = manifest;
  if (!unitIdPattern.test(id)) throw new Error(`Invalid feature id "${id}"`);
  const modules: readonly CapabilityModule[] = manifest.modules ?? [];
  checkNamespace(`Feature ${id}`, id, modules);
  for (const module of modules) {
    if (!ownedName(id, module.id))
      throw new Error(
        `Feature "${id}" has module "${module.id}", which is not "${id}" or "${id}-…"`,
      );
    for (const capability of module.capabilities) {
      const target = capability.integration?.target ?? capability.remote?.target;
      if (target !== undefined && !ownedName(id, target))
        throw new Error(
          `Feature "${id}" operation ${capability.id} names target "${target}", which is not "${id}" or "${id}-…"`,
        );
    }
  }
  for (const required of manifest.requires ?? [])
    if (!unitIdPattern.test(required) || required === id)
      throw new Error(`Feature "${id}" requires an invalid feature "${required}"`);
  return Object.freeze({ ...manifest, modules: modules as Modules });
}

/** Every module a list of feature manifests contributes, as one union for typed clients. */
export type FeatureModules<Features extends readonly FeatureManifest[]> =
  Features[number]['modules'][number];

/** The part of an application manifest that names its features and plugins. */
export interface UnitsManifest {
  readonly features?: readonly { readonly id: string }[];
  readonly plugins?: readonly { readonly id: string; readonly namespace?: string }[];
}

/** What the web and native frames read of a feature's or plugin's screens. */
export interface UnitScreensShape {
  readonly id: string;
  readonly capabilityScreens?: readonly { readonly prefix: string }[];
}

/**
 * Refuse feature and plugin screens that the application manifest does not compose, that are
 * listed out of the manifest's order, or that open capabilities outside the unit's operation
 * namespace. Shared by `defineScreens` and `defineNativeScreens`.
 */
export function checkUnitScreens(declared: {
  readonly features?: readonly UnitScreensShape[];
  readonly plugins?: readonly UnitScreensShape[];
  readonly manifest?: UnitsManifest;
}): void {
  const kinds = [
    ['Feature', declared.features ?? [], declared.manifest?.features ?? []],
    ['Plugin', declared.plugins ?? [], declared.manifest?.plugins ?? []],
  ] as const;
  if (!declared.manifest && kinds.some(([, screens]) => screens.length))
    throw new Error('Feature and plugin screens need the application manifest');
  for (const [kind, screens, units] of kinds) {
    let last = -1;
    for (const unit of screens) {
      const index = units.findIndex((entry) => entry.id === unit.id);
      if (index === -1)
        throw new Error(
          `${kind} screens "${unit.id}" have no ${kind.toLowerCase()} in the manifest`,
        );
      if (index <= last)
        throw new Error(`${kind} screens "${unit.id}" are out of the manifest's order`);
      last = index;
      const entry: { readonly id: string; readonly namespace?: string } = units[index]!;
      const namespace = entry.namespace ?? entry.id;
      for (const { prefix } of unit.capabilityScreens ?? [])
        if (!prefix.startsWith(`${namespace}.`))
          throw new Error(
            `${kind} screens "${unit.id}" open "${prefix}", which is outside the namespace "${namespace}."`,
          );
    }
  }
}
