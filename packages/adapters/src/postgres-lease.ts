import { WorkspaceOwnedError } from './exclusive-lock';
import type { PgDriver, PgQuery } from './postgres/driver';
import { openPgSchema } from './postgres/schema';

/** A commit found that another instance took the workspace over, or that the lease expired. */
export class WorkspaceLeaseLostError extends Error {
  constructor(readonly workspace: string) {
    super('Workspace lease lost: this instance no longer owns the workspace');
    this.name = 'WorkspaceLeaseLostError';
  }
}

/** One instance's hold on a workspace in a shared database, with its fencing token. */
export interface WorkspaceLease {
  readonly workspace: string;
  readonly holder: string;
  /** Larger for every new holder; a commit carrying an older one is refused. */
  readonly fence: number;
  /** Extend the expiry; throws `WorkspaceLeaseLostError` when the lease is gone. */
  renew(): Promise<void>;
  /** Expire the lease now, so the next instance need not wait for it. Idempotent. */
  release(): Promise<void>;
  /**
   * Inside a commit's transaction: throw `WorkspaceLeaseLostError` unless this lease is still
   * current and unexpired. Takes a share lock on the lease row, so a takeover waits for this
   * commit and every later commit sees the new fence.
   */
  check(tx: PgQuery): Promise<void>;
}

export interface LeaseOptions {
  /** How long the lease lasts without a renewal; 30 seconds by default. */
  readonly ttlMs?: number;
  /** Names this instance in the lease row; a new UUID by default. */
  readonly holder?: string;
}

/**
 * Take `workspace`'s lease when it is free or expired, with a fence one larger than the last
 * holder's. Rejects with `WorkspaceOwnedError` while another holder's lease is live. Expiry uses
 * the database's clock, so hosts with skewed clocks agree on it.
 *
 * Fencing, not the expiry alone, is what keeps one writer: a paused holder that wakes after a
 * takeover still reaches the database, and its next commit fails `check` there, inside the same
 * transaction that would have written.
 */
export async function acquireWorkspaceLease(
  driver: PgDriver,
  workspace: string,
  options: LeaseOptions = {},
): Promise<WorkspaceLease> {
  await openPgSchema(driver);
  const ttl = options.ttlMs ?? 30_000;
  const holder = options.holder ?? crypto.randomUUID();
  const [taken] = await driver.transaction((tx) =>
    tx.query<{ fence: string | number }>(
      `INSERT INTO workspace_lease (workspace_id, holder, fence, expires_at)
       VALUES ($1, $2, 1, clock_timestamp() + $3 * interval '1 millisecond')
       ON CONFLICT (workspace_id) DO UPDATE
         SET holder = excluded.holder, fence = workspace_lease.fence + 1, expires_at = excluded.expires_at
         WHERE workspace_lease.expires_at <= clock_timestamp()
       RETURNING fence`,
      [workspace, holder, ttl],
    ),
  );
  if (!taken) throw new WorkspaceOwnedError(`postgres:${workspace}`);
  const fence = Number(taken.fence);
  const current = [workspace, holder, fence] as const;
  let released = false;
  return {
    workspace,
    holder,
    fence,
    async renew() {
      const [row] = await driver.transaction((tx) =>
        tx.query(
          `UPDATE workspace_lease SET expires_at = clock_timestamp() + $4 * interval '1 millisecond'
           WHERE workspace_id = $1 AND holder = $2 AND fence = $3 AND expires_at > clock_timestamp()
           RETURNING fence`,
          [...current, ttl],
        ),
      );
      if (!row) throw new WorkspaceLeaseLostError(workspace);
    },
    async release() {
      if (released) return;
      released = true;
      // The fence stays, so the next holder's is still larger.
      await driver.transaction((tx) =>
        tx.query(
          'UPDATE workspace_lease SET expires_at = clock_timestamp() WHERE workspace_id = $1 AND holder = $2 AND fence = $3',
          [...current],
        ),
      );
    },
    async check(tx) {
      const [row] = await tx.query(
        'SELECT 1 FROM workspace_lease WHERE workspace_id = $1 AND holder = $2 AND fence = $3 AND expires_at > clock_timestamp() FOR SHARE',
        [...current],
      );
      if (!row) throw new WorkspaceLeaseLostError(workspace);
    },
  };
}
