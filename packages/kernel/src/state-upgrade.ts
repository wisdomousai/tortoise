import type { SliceVersion, StateUpgrade, StateVersions } from '@tortoise/runtime';
import type { AnyApplicationDefinition } from './application';
import { composedUnits, statefulUnits } from './features/units';
import { currentVersion, migrateSlice } from './migrations';

type Root = Record<string, unknown>;

/**
 * The storage upgrade for a composed definition, in this order:
 *
 * 1. Adopt: a feature slice missing from a workspace stored before the application version
 *    that moved the data is built from the application's state as stored (`FeatureAdoption`).
 * 2. The application's migrations see its state without unit slices, against its own stamp.
 * 3. Each feature's and plugin's migrations see only its slice, against its own stamp
 *    (`feature:<id>` or `plugin:<id>`), including an adopted slice.
 * 4. The definition's unversioned `upgradeState` runs on the result, as before, and creates the
 *    slice of a unit new to the workspace.
 * 5. The stamps of every slice are returned for storage to write.
 *
 * Each step is deterministic, so storage can run it on every load until a commit persists it. A
 * slice this code cannot read throws, so storage refuses the workspace instead of reading or
 * overwriting it.
 */
export function stateUpgrade(
  definition: AnyApplicationDefinition,
  ownerId: string,
): StateUpgrade<unknown> {
  const units = statefulUnits(composedUnits(definition));
  const keys = new Set(units.map((unit) => unit.id));
  const versions: StateVersions = Object.freeze({
    application: currentVersion(definition.migrations),
    ...Object.fromEntries(
      units.map((unit) => [unit.stamp, currentVersion(unit.feature.state!.migrations)]),
    ),
  });
  return {
    versions,
    upgrade(stored, stamps) {
      const value = (stored ?? {}) as Root;
      const own = Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
      const storedVersion = stamps?.application?.version ?? 1;
      const slices: Root = {};
      const sliceStamps: Record<string, SliceVersion | undefined> = {};
      for (const unit of units) {
        if (value[unit.id] !== undefined) {
          slices[unit.id] = value[unit.id];
          sliceStamps[unit.stamp] = stamps?.[unit.stamp];
        } else if (unit.adopt && storedVersion < unit.adopt.before) {
          const version = unit.adopt.version ?? 1;
          slices[unit.id] = unit.adopt.from(own, ownerId);
          sliceStamps[unit.stamp] = { version, readableFrom: version };
        }
      }
      const application = migrateSlice(
        'Application',
        definition.migrations,
        own,
        stamps?.application,
        ownerId,
      );
      const migrated: Root = { ...(application.value as Root) };
      const next: Record<string, SliceVersion> = { application: application.stamp };
      for (const unit of units) {
        // A unit new to this workspace gets a fresh slice from `upgradeState` below.
        if (!Object.hasOwn(slices, unit.id)) {
          next[unit.stamp] = versions[unit.stamp]!;
          continue;
        }
        const result = migrateSlice(
          `${unit.kind === 'feature' ? 'Feature' : 'Plugin'} ${unit.id}`,
          unit.feature.state!.migrations,
          slices[unit.id],
          sliceStamps[unit.stamp],
          ownerId,
        );
        migrated[unit.id] = result.value;
        next[unit.stamp] = result.stamp;
      }
      const state = definition.upgradeState ? definition.upgradeState(migrated, ownerId) : migrated;
      return { state, versions: next };
    },
  };
}
