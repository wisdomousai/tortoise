import { join } from 'node:path';
import { SQLiteStorage } from '@tortoise/adapters/sqlite';
import { acquireWorkspaceOwnership } from '@tortoise/adapters/ownership';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import type { AnyApplicationDefinition } from '@tortoise/kernel/application';
import { LOCAL_USER } from '@tortoise/kernel/instance';
import { stateUpgrade } from '@tortoise/kernel/state-upgrade';
import type { HostPlatform, PlatformOwnership } from '@tortoise/kernel/platform';
import { hostComponents } from '../components';
import { loopbackIngress } from '../plugins/ports';

/** Journal entries a long-running workspace keeps; a subscriber further behind reloads. */
export const JOURNAL_RETENTION = 50_000;

/**
 * Workspace storage shared by the HTTP host and embedded instances: one row per record, with
 * the journal capped at `JOURNAL_RETENTION` entries. Command results are all kept, so a retry is never
 * run twice. A new workspace starts from the definition's state; a stored one passes through its
 * upgrade on load.
 */
export function workspaceStorage(definition: AnyApplicationDefinition, canonicalPath: string) {
  return workspaceDatabase(definition, join(canonicalPath, WORKSPACE_DATABASE));
}

/** The workspace database's file name inside a workspace directory. */
export const WORKSPACE_DATABASE = 'workspace.sqlite';

/** `workspaceStorage` over a database file, such as a staged copy being migrated. */
export function workspaceDatabase(definition: AnyApplicationDefinition, file: string) {
  return new SQLiteStorage<unknown>(file, () => definition.createState(LOCAL_USER), {
    retention: { journal: JOURNAL_RETENTION },
    upgrade: stateUpgrade(definition, LOCAL_USER),
  });
}

/** Ownership a serving host can also announce: `publish` records its endpoint for clients. */
export interface ServingOwnership extends PlatformOwnership {
  publish(endpoint: string): Promise<void>;
}
/** A platform a serving host runs on: its ownership can publish the endpoint. */
export interface ServingPlatform extends HostPlatform {
  acquireOwnership(workspacePath: string): Promise<ServingOwnership>;
}

/**
 * The desktop and server platform. Ownership is an OS-held SQLite lock in the workspace
 * directory, so a crash releases it; storage is one SQLite file next to it, one row per record, and blobs
 * live in its `blobs` directory. The host's
 * own components (its HTTP listener and the agent providers) join every deployment, and the
 * default listener is loopback.
 */
export const bunPlatform: ServingPlatform = Object.freeze({
  id: 'bun',
  capabilities: new Set(['sockets', 'child-process', 'ingress', 'folders'] as const),
  components: hostComponents,
  ingress: loopbackIngress,
  acquireOwnership: (workspacePath: string) => acquireWorkspaceOwnership(workspacePath),
  openStorage: (definition: AnyApplicationDefinition, ownership: { canonicalPath: string }) =>
    workspaceStorage(definition, ownership.canonicalPath),
  openBlobs: (ownership: { canonicalPath: string }) =>
    createFileBlobStore(join(ownership.canonicalPath, 'blobs')),
});
