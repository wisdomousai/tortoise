import type { SliceVersion, StateUpgrade, StateVersions } from '@agent-native/runtime';
import type { AnyApplicationDefinition } from './application';
import { currentVersion, migrateSlice } from './migrations';

type Root = Record<string, unknown>;

const pluginSlice = (id: string) => `plugin:${id}`;

/**
 * The storage upgrade for a composed definition. The application's migrations see its state
 * without plugin slices and each plugin's migrations see only its slice, each against its own
 * stamp; then the definition's unversioned `upgradeState` runs on the result, as before, and
 * creates the slice of a plugin new to the workspace. A slice this code cannot read throws, so
 * storage refuses the workspace instead of reading or overwriting it.
 */
export function stateUpgrade(
  definition: AnyApplicationDefinition,
  ownerId: string,
): StateUpgrade<unknown> {
  const plugins = (definition.plugins ?? []).filter((plugin) => plugin.state);
  const keys = new Set(plugins.map((plugin) => plugin.manifest.id));
  const versions: StateVersions = Object.freeze({
    application: currentVersion(definition.migrations),
    ...Object.fromEntries(
      plugins.map((plugin) => [
        pluginSlice(plugin.manifest.id),
        currentVersion(plugin.state!.migrations),
      ]),
    ),
  });
  return {
    versions,
    upgrade(stored, stamps) {
      const value = (stored ?? {}) as Root;
      const own = Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
      const application = migrateSlice(
        'Application',
        definition.migrations,
        own,
        stamps?.application,
        ownerId,
      );
      const migrated: Root = { ...(application.value as Root) };
      const next: Record<string, SliceVersion> = { application: application.stamp };
      for (const plugin of plugins) {
        const key = plugin.manifest.id;
        const slice = pluginSlice(key);
        // A plugin new to this workspace gets a fresh slice from `upgradeState` below.
        if (value[key] === undefined) {
          next[slice] = versions[slice]!;
          continue;
        }
        const result = migrateSlice(
          `Plugin ${key}`,
          plugin.state!.migrations,
          value[key],
          stamps?.[slice],
          ownerId,
        );
        migrated[key] = result.value;
        next[slice] = result.stamp;
      }
      const state = definition.upgradeState ? definition.upgradeState(migrated, ownerId) : migrated;
      return { state, versions: next };
    },
  };
}
