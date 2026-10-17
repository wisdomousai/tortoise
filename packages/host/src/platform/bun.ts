import { join } from 'node:path';
import { SQLiteStorage } from '@agent-native/adapters/sqlite';
import { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/authority';
import type { HostPlatform } from '@agent-native/kernel/platform';
import { hostComponents } from '../components';
import { loopbackIngress } from '../plugins/ports';

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
 * The desktop and server platform. Ownership is an OS-held SQLite lock in the workspace
 * directory, so a crash releases it; storage is one SQLite snapshot file next to it. The host's
 * own components (its HTTP listener and the agent providers) join every deployment, and the
 * default listener is loopback.
 */
export const bunPlatform: HostPlatform = Object.freeze({
  id: 'bun',
  capabilities: new Set(['sockets', 'child-process', 'ingress'] as const),
  components: hostComponents,
  ingress: loopbackIngress,
  acquireOwnership: (workspacePath: string) => acquireWorkspaceOwnership(workspacePath),
  openStorage: (definition: AnyApplicationDefinition, ownership: { canonicalPath: string }) =>
    workspaceStorage(definition, ownership.canonicalPath),
});
