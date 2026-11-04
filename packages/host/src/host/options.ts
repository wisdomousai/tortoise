import type { ExecutionContext } from '@tortoise/runtime';
import type { Harness } from '@tortoise/agents/types';
import type { ServingOwnership, ServingPlatform } from '../platform/bun';
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
  /**
   * Where the workspace's ownership and storage live: the Bun platform's local SQLite files by
   * default, or `hostedPlatform` for a workspace in a shared database.
   */
  platform?: ServingPlatform;
}

export type WorkspaceOwnership = ServingOwnership;

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
