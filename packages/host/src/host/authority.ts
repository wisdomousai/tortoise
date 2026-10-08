import { join } from 'node:path';
import {
  createApplicationRuntime,
  type AnyApplicationDefinition,
  type Observer,
} from '../application';
import { LOCAL_WORKSPACE, workspaceStorage } from '../embedded';
import { combineIntegrations } from '../integrations';
import { openPlugins } from '../plugins/lifecycle';
import type { CleanupStack, StartHostOptions, WorkspaceOwnership } from './options';
import { SQLiteRunStore } from './run-store';

/**
 * Open the workspace's authority in the order the guarantees need: plugins (and so the ports),
 * identity, storage, the runtime, the plugins' `ready` hooks, then the application's own
 * integrations.
 */
export async function openAuthority(
  definition: AnyApplicationDefinition,
  options: StartHostOptions,
  ownership: WorkspaceOwnership,
  cleanup: CleanupStack,
) {
  // Plugins first: one that refuses (an unusable policy, an unwritable audit log) stops startup
  // before the workspace is opened. Closed last, after everything that might still audit.
  const plugins = await openPlugins(definition, {
    workspacePath: ownership.canonicalPath,
    component: 'authority',
    instance: ownership.instance,
    serving: true,
    ...(options.settings ? { settings: options.settings } : {}),
  });
  cleanup.push(() => plugins.close());
  const { ports } = plugins;
  // Identity before any state opens: a port that admits only the launcher's delegated grant
  // means the trusted local owner is never issued a session.
  ports.identity.admit(options.agentConnection?.context);
  const storage = workspaceStorage(definition, ownership.canonicalPath);
  cleanup.push(() => storage.close());
  const runStore = new SQLiteRunStore(join(ownership.canonicalPath, 'runs.sqlite'));
  cleanup.push(() => runStore.close());
  const application = createApplicationRuntime(definition, {
    storage,
    ...(ports.eventLog ? { eventLog: ports.eventLog } : {}),
    services: { ...(definition.services as object), ...plugins.services },
  });
  // Every `ready` hook (attestation, crash recovery) precedes any integration pass or request,
  // so no new command reuses a cursor a recovery compares against.
  await plugins.ready(application);
  const connections =
    definition.connect?.({ application, workspaceId: LOCAL_WORKSPACE, network: ports.network }) ??
    {};
  const integrations = combineIntegrations({
    application,
    workspaceId: LOCAL_WORKSPACE,
    connections,
  });
  cleanup.push(() => integrations.stop());
  const observers: Observer[] = [];
  cleanup.push(async () => {
    await Promise.all(observers.map((observer) => observer.stop()));
  });
  return {
    plugins,
    ports,
    storage,
    runStore,
    application,
    connections,
    integrations,
    observers,
    localOwner: ports.identity.localOwnerSessions,
  };
}
export type Authority = Awaited<ReturnType<typeof openAuthority>>;
