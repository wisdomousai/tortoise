import type { AnyApplicationDefinition } from '../application';
import { checkMigrations } from '../migrations';
import type { AnyHostPlugin } from '../plugin';
import type { ComposedUnit } from './units';

/**
 * Check that the server plugins are exactly the manifest's, in the same order, and that each
 * plugin's `requires` names a feature or a plugin composed before it. Order matters because the
 * host opens plugins in it.
 */
export function checkPlugins(
  declared: readonly { readonly id: string }[],
  plugins: readonly AnyHostPlugin[],
  features: readonly string[] = [],
) {
  const ids = plugins.map((plugin) => plugin.manifest.id);
  const expected = declared.map((plugin) => plugin.id);
  if (ids.join() !== expected.join())
    throw new Error(
      `Application plugins [${ids.join(', ')}] do not match its manifest's [${expected.join(', ')}]`,
    );
  for (const [index, plugin] of plugins.entries())
    for (const required of plugin.requires ?? [])
      if (!ids.slice(0, index).includes(required) && !features.includes(required))
        throw new Error(`Plugin "${plugin.manifest.id}" requires "${required}" composed before it`);
}

/** The mounted features are exactly the manifest's, in the same order, with the same manifests. */
function checkFeatures(definition: AnyApplicationDefinition, units: readonly ComposedUnit[]) {
  const mounted = units.filter((unit) => unit.kind === 'feature');
  const ids = mounted.map((unit) => unit.id);
  const expected = (definition.manifest.features ?? []).map((feature) => feature.id);
  if (ids.join() !== expected.join())
    throw new Error(
      `Application features [${ids.join(', ')}] do not match its manifest's [${expected.join(', ')}]`,
    );
  for (const [index, unit] of mounted.entries())
    if (unit.feature.manifest !== definition.manifest.features![index])
      throw new Error(`Feature "${unit.id}" is mounted with a different manifest than listed`);
}

/**
 * An adoption must name a version the application's migrations reach through a step that is not
 * `compatible`, so code from before the data moved refuses the workspace instead of reading it
 * without the data.
 */
function checkAdoption(definition: AnyApplicationDefinition, unit: ComposedUnit) {
  const { adopt } = unit;
  if (!adopt) return;
  if (!unit.feature.state) throw new Error(`Feature "${unit.id}" adopts data but keeps no state`);
  const step = definition.migrations?.steps?.find((candidate) => candidate.to === adopt.before);
  if (!step || step.compatible)
    throw new Error(
      `Feature "${unit.id}" adopts data before application version ${adopt.before}, which no incompatible application migration step reaches`,
    );
}

/**
 * Everything composition refuses beyond what the manifest already checked: feature and plugin
 * lists that differ from the manifest's, slice migrations that do not chain, adoptions without a
 * matching application step, and an application service under a unit's id.
 */
export function checkUnits(definition: AnyApplicationDefinition, units: readonly ComposedUnit[]) {
  checkFeatures(definition, units);
  checkPlugins(
    definition.manifest.plugins ?? [],
    definition.plugins ?? [],
    units.filter((unit) => unit.kind === 'feature').map((unit) => unit.id),
  );
  if (definition.migrations) checkMigrations('Application', definition.migrations);
  for (const unit of units) {
    const label = `${unit.kind === 'feature' ? 'Feature' : 'Plugin'} ${unit.id}`;
    if (unit.feature.state?.migrations) checkMigrations(label, unit.feature.state.migrations);
    checkAdoption(definition, unit);
    const services = definition.services as Record<string, unknown> | undefined;
    if (services && typeof services === 'object' && Object.hasOwn(services, unit.id))
      throw new Error(`Application services already have a "${unit.id}" key; ${label} owns it`);
  }
}
