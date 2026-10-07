import { join } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { acquireWorkspaceOwnership, WorkspaceOwnedError } from '@agent-native/adapters/ownership';
import { createApplicationRuntime, type AnyApplicationDefinition } from './application';
import { combineIntegrations } from './integrations';

/** The single workspace a local authority serves. */
export const LOCAL_WORKSPACE = 'local';
/** The principal a local authority starts as; it owns the workspace it creates. */
export const LOCAL_OWNER = 'owner';

/**
 * Workspace document storage shared by the HTTP host and embedded authorities. A new workspace
 * starts from the definition's state; a stored one passes through its upgrade on load.
 */
export function workspaceStorage(definition: AnyApplicationDefinition, canonicalPath: string) {
  return new SQLiteStorage<unknown>(
    join(canonicalPath, 'workspace.sqlite'),
    () => definition.createState(LOCAL_OWNER),
    definition.upgradeState
      ? { upgrade: (state) => definition.upgradeState!(state, LOCAL_OWNER) }
      : undefined,
  );
}

/**
 * Open the workspace in this process with no network listener, for stdio MCP and one-shot CLI
 * use inside a sandbox. Ownership is the same OS lock the HTTP host takes, so an embedded process
 * and a running host can never both write one workspace. Fails with CONFLICT when one is live.
 * Observers never start here; integrations are built but only run when the caller starts them.
 */
export async function openEmbeddedAuthority(
  definition: AnyApplicationDefinition,
  options: { workspacePath: string },
) {
  const ownership = await acquireWorkspaceOwnership(options.workspacePath).catch((error) => {
    if (error instanceof WorkspaceOwnedError)
      throw new ApplicationError(
        'CONFLICT',
        'A live authority owns this workspace; attach with --connection or stop it first',
      );
    throw error;
  });
  const storage = workspaceStorage(definition, ownership.canonicalPath);
  const application = createApplicationRuntime(definition, { storage });
  const integrations = combineIntegrations({
    application,
    workspaceId: LOCAL_WORKSPACE,
    connections: definition.connect?.({ application, workspaceId: LOCAL_WORKSPACE }) ?? {},
  });
  let closed = false;
  return {
    application,
    integrations,
    workspacePath: ownership.canonicalPath,
    /** Stop background delivery, then release storage before the ownership lock. */
    async close() {
      if (closed) return;
      closed = true;
      await integrations.stop();
      await storage.close();
      await ownership.release();
    },
  };
}
export type EmbeddedAuthority = Awaited<ReturnType<typeof openEmbeddedAuthority>>;
