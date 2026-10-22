import type { AnyApplicationDefinition } from '../application';
import type { Feature, FeatureAdoption, FeatureMount } from '../feature';
import type { AnyHostPlugin } from '../plugin';
import { pluginNamespace } from '../plugin-manifest';

/**
 * A feature or plugin as composition sees it. Features come first, in mount order, then plugins
 * in manifest order, so every fold (state, handlers, policy, services, connections) treats them
 * the same way and only stamps, namespaces and lifecycles differ.
 */
export interface ComposedUnit {
  readonly kind: 'feature' | 'plugin';
  readonly id: string;
  /** The first segment of every operation id the unit declares. */
  readonly namespace: string;
  /** The key of the slice's version in `stateVersions`. */
  readonly stamp: string;
  readonly feature: Feature;
  readonly access?: (state: any) => unknown;
  readonly hooks?: FeatureMount['hooks'];
  readonly adopt?: FeatureAdoption;
  /** The plugin, for a unit of kind `plugin`. */
  readonly plugin?: AnyHostPlugin;
}

const fromMount = (mount: FeatureMount): ComposedUnit => ({
  kind: 'feature',
  id: mount.feature.manifest.id,
  namespace: mount.feature.manifest.id,
  stamp: `feature:${mount.feature.manifest.id}`,
  feature: mount.feature,
  ...(mount.access ? { access: mount.access } : {}),
  ...(mount.hooks ? { hooks: mount.hooks } : {}),
  ...(mount.adopt ? { adopt: mount.adopt } : {}),
});

const fromPlugin = (plugin: AnyHostPlugin): ComposedUnit => ({
  kind: 'plugin',
  id: plugin.manifest.id,
  namespace: pluginNamespace(plugin.manifest),
  stamp: `plugin:${plugin.manifest.id}`,
  feature: plugin,
  plugin,
});

/** The definition's features, then its plugins. */
export function composedUnits(
  definition: Pick<AnyApplicationDefinition, 'features' | 'plugins'>,
): readonly ComposedUnit[] {
  return [
    ...(definition.features ?? []).map(fromMount),
    ...(definition.plugins ?? []).map(fromPlugin),
  ];
}

/** The units that keep a state slice. */
export const statefulUnits = (units: readonly ComposedUnit[]) =>
  units.filter((unit) => unit.feature.state);
