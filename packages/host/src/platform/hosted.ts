import { join } from 'node:path';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import { acquireWorkspaceOwnership } from '@tortoise/adapters/ownership';
import { createPostgresBlobStore } from '@tortoise/adapters/postgres-blobs';
import { bunPostgres } from '@tortoise/adapters/postgres-bun';
import { acquireWorkspaceLease, type WorkspaceLease } from '@tortoise/adapters/postgres-lease';
import { PostgresStorage, type PgDriver } from '@tortoise/adapters/postgres-storage';
import { ApplicationError } from '@tortoise/contracts';
import type { AnyApplicationDefinition } from '@tortoise/kernel/application';
import { LOCAL_USER } from '@tortoise/kernel/instance';
import type { HostPlatform, PlatformOwnership } from '@tortoise/kernel/platform';
import { stateUpgrade } from '@tortoise/kernel/state-upgrade';
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
 * plus the OS lock on the local directory, which still holds the run history and the plugins'
 * local files. Blobs live in the database too, so a takeover reads the same attachments. Every commit checks the lease's fence inside its transaction, so an
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
        () => definition.createState(LOCAL_USER),
        {
          retention: { journal: JOURNAL_RETENTION },
          upgrade: stateUpgrade(definition, LOCAL_USER),
          scope: options.workspace,
          fence: (tx) => lease.check(tx),
        },
      );
    },
    // Blobs an earlier release kept in the local directory are read from there and copied in.
    openBlobs(ownership: PlatformOwnership) {
      const lease = leases.get(ownership.instance);
      if (!lease) throw new Error('Workspace blobs need the ownership this platform issued');
      return createPostgresBlobStore(options.database, options.workspace, {
        fence: (tx) => lease.check(tx),
        fallback: createFileBlobStore(join(ownership.canonicalPath, 'blobs')),
      });
    },
  } satisfies HostPlatform);
}

/**
 * The hosted platform for `workspace` in the Postgres database that `TORTOISE_DATABASE_URL`
 * names, as `serve --hosted-workspace` and a development launch start it. The URL is read from the
 * environment, never a flag, so its credentials stay out of the process list. Losing the lease
 * stops the host with exit code 1, for the orchestrator to restart it behind the new holder.
 */
export function hostedPlatformFromEnvironment(workspace: string, env = process.env) {
  const url = env.TORTOISE_DATABASE_URL;
  if (!url)
    throw new ApplicationError(
      'INVALID_INPUT',
      '--hosted-workspace needs TORTOISE_DATABASE_URL in the environment',
    );
  return hostedPlatform({
    database: bunPostgres(url),
    workspace,
    onLeaseLost(error) {
      console.error(JSON.stringify({ type: 'lease-lost', workspace, message: error.message }));
      process.exitCode = 1;
      process.kill(process.pid, 'SIGTERM');
    },
  });
}
