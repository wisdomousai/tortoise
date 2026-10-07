import { join } from 'node:path';
import { ApplicationError } from '@agent-native/contracts';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { acquireWorkspaceOwnership, WorkspaceOwnedError } from '@agent-native/adapters/ownership';
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
 */
export async function openEmbeddedAuthority(options: {
  workspacePath: string;
  systemOfRecord: SystemOfRecordPort<QualityItem>;
}) {
  const ownership = await acquireWorkspaceOwnership(options.workspacePath).catch((error) => {
    if (error instanceof WorkspaceOwnedError)
      throw new ApplicationError(
        'CONFLICT',
        'A live authority owns this workspace; attach with --connection or stop it first',
      );
    throw error;
  });
  const storage = workspaceStorage(ownership.canonicalPath);
  const application = createApplicationRuntime({ storage });
  const integration = createQualityIntegration({
    application,
    port: options.systemOfRecord,
    workspaceId: LOCAL_WORKSPACE,
  });
  let closed = false;
  return {
    application,
    integration,
    workspacePath: ownership.canonicalPath,
    /** Stop background delivery, then release storage before the ownership lock. */
    async close() {
      if (closed) return;
      closed = true;
      await integration.stop();
      await storage.close();
      await ownership.release();
    },
  };
}
export type EmbeddedAuthority = Awaited<ReturnType<typeof openEmbeddedAuthority>>;
