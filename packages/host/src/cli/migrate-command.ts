import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { takeFlag } from '@tortoise/adapters/cli';
import { acquireWorkspaceOwnership } from '@tortoise/adapters/ownership';
import { SQLiteStorage, bunSqlDriver } from '@tortoise/adapters/sqlite';
import { restoreBackup, verifyBackup } from '@tortoise/adapters/workspace-backup';
import { stateUpgrade } from '@tortoise/kernel/state-upgrade';
import { LOCAL_OWNER } from '@tortoise/kernel/instance';
import type { StateVersions } from '@tortoise/runtime';
import type { AnyApplicationDefinition } from '../application';
import { WORKSPACE_DATABASE, workspaceDatabase } from '../platform/bun';
import { rejectRemaining, report, workspaceOf } from './args';

/** One workspace's slices that change version, as `from → to`. */
export interface WorkspaceMigration {
  readonly workspace: string;
  readonly slices: Readonly<Record<string, { readonly from: number; readonly to: number }>>;
}

/** A consistent copy of a database file; `to` must not exist. */
function copyDatabase(from: string, to: string) {
  const driver = bunSqlDriver(from);
  try {
    driver.run('VACUUM INTO ?', to);
  } finally {
    driver.close();
  }
}

/** Each workspace's stamps as stored, read without running any migration. */
async function storedVersions(file: string) {
  const raw = new SQLiteStorage<unknown>(file, () => ({}));
  try {
    const stamps = new Map<string, StateVersions | undefined>();
    for (const id of await raw.workspaces())
      stamps.set(id, await raw.read(id, async (snapshot) => snapshot.stateVersions));
    return stamps;
  } finally {
    await raw.close();
  }
}

/**
 * The slices this definition would move forward. State never stamped counts as version 1; a
 * newer stamp is not a migration (storage reads it or refuses it on load).
 */
function pendingMigrations(
  definition: AnyApplicationDefinition,
  stored: ReadonlyMap<string, StateVersions | undefined>,
): WorkspaceMigration[] {
  const target = stateUpgrade(definition, LOCAL_OWNER).versions;
  return [...stored].flatMap(([workspace, stamps]) => {
    const slices: Record<string, { from: number; to: number }> = {};
    for (const [slice, { version }] of Object.entries(target)) {
      const from = stamps?.[slice]?.version ?? 1;
      if (from < version) slices[slice] = { from, to: version };
    }
    return Object.keys(slices).length ? [{ workspace, slices }] : [];
  });
}

/**
 * Migrate each workspace in the staged copy and commit the result. The authorization revision
 * moves, so a client that reconnects resets its cached reads, which the old code produced.
 */
async function migrateCopy(
  definition: AnyApplicationDefinition,
  file: string,
  migrations: readonly WorkspaceMigration[],
) {
  const storage = workspaceDatabase(definition, file);
  try {
    for (const { workspace } of migrations)
      await storage.transact(workspace, async (snapshot) => {
        snapshot.authorizationRevision += 1;
      });
  } finally {
    await storage.close();
  }
}

/**
 * The health check before switching: the copy passes SQLite's integrity check, every stamp is
 * this code's version as persisted, and every workspace loads through the definition's upgrade.
 */
async function checkCopy(definition: AnyApplicationDefinition, file: string) {
  verifyBackup(file);
  const left = pendingMigrations(definition, await storedVersions(file));
  if (left.length)
    throw new Error(`Workspace ${left[0]!.workspace} is not at this version after migrating`);
  const storage = workspaceDatabase(definition, file);
  try {
    for (const workspace of await storage.workspaces())
      await storage.read(workspace, async () => undefined);
  } finally {
    await storage.close();
  }
}

/**
 * `migrate [--dry-run]`: staged activation of this code's state versions. It takes the
 * workspace's ownership lock (so no host serves it), migrates a copy, health-checks the copy
 * and only then replaces the database, keeping the previous one beside it as
 * `workspace.sqlite.before-migrate`. A failed migration or check leaves the database untouched.
 * `--dry-run` runs the migration and the check on the copy and discards it.
 *
 * Rolling back means running older code on the migrated state, never restoring the previous
 * copy over records committed since; storage refuses older code unless every step since its
 * version was declared compatible.
 */
export async function migrateCommand(definition: AnyApplicationDefinition, args: string[]) {
  const dryRun = takeFlag(args, 'dry-run', false) !== undefined;
  const ownership = await acquireWorkspaceOwnership(workspaceOf(args));
  const live = join(ownership.canonicalPath, WORKSPACE_DATABASE);
  const staged = `${live}.migrating`;
  try {
    rejectRemaining(args);
    if (!(await Bun.file(live).exists())) {
      report({ migrated: false, workspaces: [] });
      return 0;
    }
    await rm(staged, { force: true });
    copyDatabase(live, staged);
    const workspaces = pendingMigrations(definition, await storedVersions(staged));
    if (workspaces.length) {
      await migrateCopy(definition, staged, workspaces);
      await checkCopy(definition, staged);
    }
    if (dryRun || !workspaces.length) {
      report({ migrated: false, dryRun, workspaces });
      return 0;
    }
    const previous = `${live}.before-migrate`;
    await rm(previous, { force: true });
    copyDatabase(live, previous);
    await restoreBackup(staged, live);
    report({ migrated: true, workspaces, previous });
    return 0;
  } catch (error) {
    // The envelope on stdout hides internal detail; the operator needs the step that failed.
    console.error(`migrate: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await rm(staged, { force: true });
    await ownership.release();
  }
}
