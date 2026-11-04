import type { MigrationStep, SliceVersion, StateMigrations } from '@tortoise/runtime';

export type { MigrationStep, StateMigrations };

const UNVERSIONED = 1;

/** Refuse a chain with gaps, overlaps or an end other than `version`, at definition time. */
export function checkMigrations(slice: string, migrations: StateMigrations): void {
  const { version, steps = [] } = migrations;
  if (!Number.isInteger(version) || version < UNVERSIONED)
    throw new Error(`${slice} state version must be a positive integer`);
  for (const [index, step] of steps.entries()) {
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to) || step.to <= step.from)
      throw new Error(`${slice} migration ${index} must go from a lower to a higher version`);
    const next = steps[index + 1];
    if (next && next.from !== step.to)
      throw new Error(`${slice} migrations must chain: ${step.to} is followed by ${next.from}`);
  }
  if (steps.length && steps.at(-1)!.to !== version)
    throw new Error(`${slice} migrations end at ${steps.at(-1)!.to}, not at version ${version}`);
}

/** The oldest version that reads state at `version`: walk down while each step was compatible. */
function readableFrom(migrations: StateMigrations, version: number): number {
  let oldest = version;
  for (const step of [...(migrations.steps ?? [])].reverse())
    if (step.to === oldest && step.compatible) oldest = step.from;
  return oldest;
}

/** The stamp of a slice this code created. */
export const currentVersion = (migrations: StateMigrations | undefined): SliceVersion => {
  const version = migrations?.version ?? UNVERSIONED;
  return { version, readableFrom: migrations ? readableFrom(migrations, version) : version };
};

/**
 * Bring one stored slice to this code's version. Newer state is read unchanged when its stamp
 * says this version can read it (only compatible steps since), and refused otherwise. Older
 * state runs through the steps from its version; a version with no path is refused.
 */
export function migrateSlice(
  slice: string,
  migrations: StateMigrations | undefined,
  stored: unknown,
  stamp: SliceVersion | undefined,
  ownerId: string,
): { readonly value: unknown; readonly stamp: SliceVersion } {
  const target = migrations?.version ?? UNVERSIONED;
  const from = stamp?.version ?? UNVERSIONED;
  if (from > target) {
    if (target >= (stamp?.readableFrom ?? from)) return { value: stored, stamp: stamp! };
    throw new Error(
      `${slice} state is version ${from}, which needs code at version ${stamp?.readableFrom ?? from} or later; this code is at ${target}`,
    );
  }
  let value = stored;
  let oldest = stamp?.readableFrom ?? from;
  let at = from;
  for (const step of migrations?.steps ?? []) {
    if (step.from < at) continue;
    if (step.from !== at) break;
    value = step.up(value, ownerId);
    oldest = step.compatible ? oldest : step.to;
    at = step.to;
  }
  if (at !== target)
    throw new Error(`${slice} state version ${from} has no migration to ${target}`);
  return { value, stamp: { version: target, readableFrom: oldest } };
}
