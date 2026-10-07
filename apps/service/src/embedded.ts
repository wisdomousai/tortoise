import { join } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { acquireWorkspaceOwnership, WorkspaceOwnedError } from '@agent-native/adapters/ownership';
import { openSecurity, type SecurityOptions } from './security';
import type { SystemOfRecordPort } from '@agent-native/integration';
import {
  createApplicationRuntime,
  createApplicationState,
  createQualityIntegration,
  upgradeApplicationState,
  type ApplicationState,
} from './composition';
import type { QualityItem } from '../../../examples/quality-inspection/fake-sor';

/** The single workspace a local authority serves. */
export const LOCAL_WORKSPACE = 'local';

/** Workspace document storage shared by the HTTP host and embedded authorities. */
export function workspaceStorage(canonicalPath: string) {
  return new SQLiteStorage<ApplicationState>(
    join(canonicalPath, 'workspace.sqlite'),
    () => createApplicationState(),
    { upgrade: (state) => upgradeApplicationState(state) },
  );
}

/**
 * Open the workspace in this process with no network listener, for stdio MCP and one-shot CLI
 * use inside a sandbox. Ownership is the same OS lock the HTTP host takes, so an embedded process
 * and a running host can never both write one workspace. Fails with CONFLICT when one is live.
 *
 * The same site policy and audit log apply as for the HTTP host: the policy is checked before
 * the workspace opens, every command is audited, and crash-orphaned audit entries are resolved
 * before the first call. The audit log has its own writer lock, so it also cannot fork.
 */
export async function openEmbeddedAuthority(options: {
  workspacePath: string;
  systemOfRecord: SystemOfRecordPort<QualityItem>;
  security?: SecurityOptions;
}) {
  const ownership = await acquireWorkspaceOwnership(options.workspacePath).catch((error) => {
    if (error instanceof WorkspaceOwnedError)
      throw new ApplicationError(
        'CONFLICT',
        'A live authority owns this workspace; attach with --connection or stop it first',
      );
    throw error;
  });
  const security = await openSecurity({
    ...options.security,
    workspacePath: ownership.canonicalPath,
    component: 'embedded',
    instance: ownership.instance,
  }).catch(async (error) => {
    await ownership.release();
    throw error;
  });
  const storage = workspaceStorage(ownership.canonicalPath);
  // One-shot and stdio processes check posture on demand only; no background interval.
  const application = createApplicationRuntime({
    storage,
    eventLog: security.eventLog,
    services: { assurance: security.monitor },
  });
  try {
    await security.attest({ instance: ownership.instance });
    await security.recover(application);
  } catch (error) {
    await storage.close();
    await security.close();
    await ownership.release();
    throw error;
  }
  const integration = createQualityIntegration({
    application,
    port: options.systemOfRecord,
    workspaceId: LOCAL_WORKSPACE,
  });
  let closed = false;
  return {
    application,
    integration,
    security,
    workspacePath: ownership.canonicalPath,
    /** Stop background delivery, release storage and the audit log, then the ownership lock. */
    async close() {
      if (closed) return;
      closed = true;
      await integration.stop();
      await storage.close();
      await security.close();
      await ownership.release();
    },
  };
}
export type EmbeddedAuthority = Awaited<ReturnType<typeof openEmbeddedAuthority>>;
