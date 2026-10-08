import { join } from 'node:path';
import {
  createApplicationRuntime,
  type AnyApplicationDefinition,
  type Observer,
} from '../application';
import { LOCAL_WORKSPACE, workspaceStorage } from '../embedded';
import { combineIntegrations } from '../integrations';
import { assertIdentity, openSecurity } from '../security';
import type { CleanupStack, StartHostOptions, WorkspaceOwnership } from './options';
import { SQLiteRunStore } from './run-store';

/**
 * Open the workspace's authority in the order the guarantees need: policy and audit log, identity
 * floor, storage, attestation and crash recovery, then the application's own integrations.
 */
export async function openAuthority(
  definition: AnyApplicationDefinition,
  options: StartHostOptions,
  ownership: WorkspaceOwnership,
  cleanup: CleanupStack,
) {
  // Policy first: an unusable policy or an unwritable audit log stops startup before the
  // workspace is opened. Closed last, after everything that might still audit.
  const security = await openSecurity({
    ...options.security,
    definition,
    workspacePath: ownership.canonicalPath,
    component: 'authority',
    instance: ownership.instance,
    childProxy: true,
  });
  cleanup.push(() => security.close());
  // Identity floor before any state opens: under `grant-file` the launcher's delegated grant is
  // the only principal, and the trusted local owner is never issued a session.
  assertIdentity(security.policy, options.agentConnection?.context);
  const storage = workspaceStorage(definition, ownership.canonicalPath);
  cleanup.push(() => storage.close());
  const runStore = new SQLiteRunStore(join(ownership.canonicalPath, 'runs.sqlite'));
  cleanup.push(() => runStore.close());
  const application = createApplicationRuntime(definition, {
    storage,
    eventLog: security.eventLog,
    services: { ...(definition.services as object), assurance: security.monitor },
  });
  // Attest what is running, then resolve audit entries a crash left open. Both precede any
  // integration pass or request, so no new command reuses a cursor recovery compares against.
  await security.attest({ instance: ownership.instance });
  await security.recover(application);
  security.monitor.start();
  const connections = definition.connect?.({ application, workspaceId: LOCAL_WORKSPACE }) ?? {};
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
  const localOwner = security.policy.policy.identity === 'local-owner';
  return {
    security,
    storage,
    runStore,
    application,
    connections,
    integrations,
    observers,
    localOwner,
  };
}
export type Authority = Awaited<ReturnType<typeof openAuthority>>;
