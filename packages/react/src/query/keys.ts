import type { Snapshot } from '@tortoise/client';

/** Root of every capability query key, so bindings never touch unrelated application caches. */
export const CAPABILITY_QUERY_KEY = 'tortoise-capability';

/** What the change stream reads from a cached capability query. */
export interface CapabilityQueryMeta extends Record<string, unknown> {
  readonly capability: string;
  readonly dependencies?: readonly string[];
  /** A remote query: local changes never refetch it, an authorization change still resets it. */
  readonly remote?: true;
}

/** The bindings' authorization fence: rejects snapshots older than a seen permission change. */
export interface SnapshotFence {
  admit<T>(snapshot: Snapshot<T>): Snapshot<T>;
}
