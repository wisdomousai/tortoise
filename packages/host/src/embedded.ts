import { join } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { acquireWorkspaceOwnership, WorkspaceOwnedError } from '@agent-native/adapters/ownership';
import { createApplicationRuntime, type AnyApplicationDefinition } from './application';
import { combineIntegrations } from './integrations';
import { openPlugins } from './plugins/lifecycle';
import type { PluginSettings } from './plugins/settings';

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
 *
 * The same plugins open as for the HTTP host, before the workspace, and their `ready` hooks run
 * before the first call; so a security plugin checks its policy, audits every command and
 * resolves crash-orphaned entries here too. Plugins never `start` here and observers never
 * start; integrations are built but only run when the caller starts them.
 */
export async function openEmbeddedAuthority(
  definition: AnyApplicationDefinition,
  options: { workspacePath: string; settings?: PluginSettings },
) {
  const ownership = await acquireWorkspaceOwnership(options.workspacePath).catch((error) => {
    if (error instanceof WorkspaceOwnedError)
      throw new ApplicationError(
        'CONFLICT',
        'A live authority owns this workspace; attach with --connection or stop it first',
      );
    throw error;
  });
  const plugins = await openPlugins(definition, {
    workspacePath: ownership.canonicalPath,
    component: 'embedded',
    instance: ownership.instance,
    serving: false,
    ...(options.settings ? { settings: options.settings } : {}),
  }).catch(async (error) => {
    await ownership.release();
    throw error;
  });
  const { ports } = plugins;
  const storage = workspaceStorage(definition, ownership.canonicalPath);
  const application = createApplicationRuntime(definition, {
    storage,
    ...(ports.eventLog ? { eventLog: ports.eventLog } : {}),
    services: { ...(definition.services as object), ...plugins.services },
  });
  try {
    await plugins.ready(application);
  } catch (error) {
    await storage.close();
    await plugins.close();
    await ownership.release();
    throw error;
  }
  const integrations = combineIntegrations({
    application,
    workspaceId: LOCAL_WORKSPACE,
    connections:
      definition.connect?.({ application, workspaceId: LOCAL_WORKSPACE, network: ports.network }) ??
      {},
  });
  let closed = false;
  return {
    application,
    integrations,
    ports,
    /** Services the plugins expose, keyed by plugin id. */
    services: plugins.services,
    workspacePath: ownership.canonicalPath,
    /** Stop background delivery, release storage, close the plugins, then the ownership lock. */
    async close() {
      if (closed) return;
      closed = true;
      await integrations.stop();
      await storage.close();
      await plugins.close();
      await ownership.release();
    },
  };
}
export type EmbeddedAuthority = Awaited<ReturnType<typeof openEmbeddedAuthority>>;
