import type { ExecutionContext } from '@agent-native/runtime';
import type { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import type { Harness } from '@agent-native/agents/types';
import type { PluginSettings } from '../plugins/settings';

export interface StartHostOptions {
  workspacePath: string;
  port?: number;
  webRoot?: string;
  harnesses?: readonly Harness[];
  runtimeManifest?: string;
  pollMs?: number;
  /**
   * Background delivery/sync cadence. `false` starts neither integration loops nor observers;
   * tests then drive passes directly.
   */
  integration?: { deliverMs?: number; syncMs?: number } | false;
  /**
   * Issue a second connection file bound to a delegated context, for an agent that runs as a
   * different OS user and must not read the owner's credential. The context comes from trusted
   * launcher configuration (see `readGrantFile`); the session expires with the grant.
   */
  agentConnection?: { context: ExecutionContext; path: string };
  /**
   * Plugin settings by key, as the launcher supplied them (see `readPluginSettings`). A key no
   * composed plugin declares refuses startup rather than be ignored.
   */
  settings?: PluginSettings;
}

export type WorkspaceOwnership = Awaited<ReturnType<typeof acquireWorkspaceOwnership>>;

/**
 * Teardown registered during startup, run newest first if startup fails. Each step is isolated:
 * a failing cleanup never prevents the next one.
 */
export function createCleanupStack(first: () => void | Promise<void>) {
  const steps: (() => void | Promise<void>)[] = [first];
  return {
    push(step: () => void | Promise<void>) {
      steps.unshift(step);
    },
    async run() {
      for (const step of steps)
        await Promise.resolve()
          .then(step)
          .catch(() => {});
    },
  };
}
export type CleanupStack = ReturnType<typeof createCleanupStack>;
