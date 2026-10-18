import { join } from 'node:path';
import { createFileBlobStore } from '@agent-native/adapters/blob-files';
import { acquireWorkspaceOwnership } from '@agent-native/adapters/ownership';
import { acquireWorkspaceLease, type WorkspaceLease } from '@agent-native/adapters/postgres-lease';
import { PostgresStorage, type PgDriver } from '@agent-native/adapters/postgres-storage';
import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/instance';
import type { HostPlatform, PlatformOwnership } from '@agent-native/kernel/platform';
import { stateUpgrade } from '@agent-native/kernel/state-upgrade';
import { JOURNAL_RETENTION, bunPlatform, type ServingPlatform } from './bun';

export interface HostedPlatformOptions {
  /** The shared database; its owner closes it after the host. */
  readonly database: PgDriver;
  /** The workspace's name in the database. One instance holds its lease at a time. */
  readonly workspace: string;
  /** Lease length; renewed every third of it. 30 seconds by default. */
  readonly leaseMs?: number;
  /** Called once when a renewal finds the lease gone; commits are refused from then on. */
  readonly onLeaseLost?: (error: Error) => void;
}

/**
 * The Bun platform with its workspace in a shared Postgres database, for a hosted instance that
 * another instance can take over. Ownership is the workspace's lease, renewed in the background,
 * plus the OS lock on the local directory, which still holds the run history, the blobs and the
 * plugins' local files. Every commit checks the lease's fence inside its transaction, so an
 * instance that lost the lease (paused, partitioned, or replaced) commits nothing more, even
 * before it notices.
 *
 * One instance serves one workspace. Serving many workspaces from one process is not built: the
 * kernel's instance, its plugins and their ports are per workspace, so a hosted deployment runs
 * one instance per workspace behind a router, and the lease makes a failover safe.
 */
export function hostedPlatform(options: HostedPlatformOptions): ServingPlatform {
  const leases = new Map<string, WorkspaceLease>();
  const ttl = options.leaseMs ?? 30_000;
  return Object.freeze({
    ...bunPlatform,
    id: 'bun',
    async acquireOwnership(workspacePath: string) {
      const local = await acquireWorkspaceOwnership(workspacePath);
      let lease: WorkspaceLease;
      try {
        lease = await acquireWorkspaceLease(options.database, options.workspace, {
          ttlMs: ttl,
          holder: local.instance,
        });
      } catch (error) {
        await local.release();
        throw error;
      }
      leases.set(local.instance, lease);
      const renewal = setInterval(() => {
        lease.renew().catch((error: Error) => {
          clearInterval(renewal);
          options.onLeaseLost?.(error);
        });
      }, ttl / 3);
      renewal.unref?.();
      return {
        canonicalPath: local.canonicalPath,
        instance: local.instance,
        publish: (endpoint: string) => local.publish(endpoint),
        async release() {
          clearInterval(renewal);
          leases.delete(local.instance);
          await lease.release().catch(() => undefined);
          await local.release();
        },
      };
    },
    openStorage(definition: AnyApplicationDefinition, ownership: PlatformOwnership) {
      const lease = leases.get(ownership.instance);
      if (!lease) throw new Error('Workspace storage needs the ownership this platform issued');
      return new PostgresStorage<unknown>(
        options.database,
        () => definition.createState(LOCAL_OWNER),
        {
          retention: { journal: JOURNAL_RETENTION },
          upgrade: stateUpgrade(definition, LOCAL_OWNER),
          scope: options.workspace,
          fence: (tx) => lease.check(tx),
        },
      );
    },
    openBlobs: (ownership: { canonicalPath: string }) =>
      createFileBlobStore(join(ownership.canonicalPath, 'blobs')),
  } satisfies HostPlatform);
}
