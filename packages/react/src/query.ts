import { useEffect } from 'react';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import {
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { ChangeBatch, Snapshot, Transport } from '@agent-native/client';

/** Root of every capability query key, so bindings never touch unrelated application caches. */
export const CAPABILITY_QUERY_KEY = 'agent-native-capability';

/** Resource types (the text before `:`) touched by a change batch. */
export function changedResourceTypes(batch: Pick<ChangeBatch, 'changes'>): Set<string> {
  return new Set(
    batch.changes.map((change) => change.resource.slice(0, change.resource.indexOf(':'))),
  );
}

/**
 * Whether a query must refetch after changes to `types`. A query that declares no dependencies
 * is refetched on every change: missing metadata costs a request, never a stale screen.
 */
export function isAffected(
  dependencies: readonly string[] | undefined,
  types: ReadonlySet<string>,
) {
  return !dependencies?.length || dependencies.some((type) => types.has(type));
}

interface CapabilityQueryMeta extends Record<string, unknown> {
  readonly capability: string;
  readonly dependencies?: readonly string[];
}

/** What a change batch requires of the capability cache. */
type BatchAction = 'ignore' | 'reset' | 'invalidate' | 'changes';

/**
 * The authorization fence of one transport. A snapshot produced under an older authorization
 * revision than the stream has observed is rejected instead of cached, so a slow response cannot
 * restore data that a revocation removed.
 */
function createAuthorizationFence() {
  // Highest revision seen anywhere; older snapshots are rejected instead of cached.
  let fenceRevision = -1;
  // Revision last applied from the stream; a higher one resets every cached query, including
  // queries whose own snapshot already reached it (other entries may predate the change).
  let streamRevision = -1;
  // Lowest revision of any snapshot cached before the stream's first batch, which has no earlier
  // stream revision to compare against.
  let oldestSnapshot = Infinity;
  return {
    admit<T>(snapshot: Snapshot<T>): Snapshot<T> {
      if (snapshot.authorizationRevision < fenceRevision)
        throw new Error('Snapshot superseded by a permission change');
      fenceRevision = snapshot.authorizationRevision;
      oldestSnapshot = Math.min(oldestSnapshot, fenceRevision);
      return snapshot;
    },
    observe(batch: ChangeBatch): BatchAction {
      const first = streamRevision < 0;
      // The first batch compares with the snapshots cached before the stream started.
      const previous = first ? oldestSnapshot : streamRevision;
      if (batch.authorizationRevision < streamRevision) return 'ignore';
      streamRevision = batch.authorizationRevision;
      fenceRevision = Math.max(fenceRevision, streamRevision);
      // Reset, not invalidate: invalidation keeps showing the old data while it refetches.
      if (streamRevision > previous) return 'reset';
      // A stream's first batch is a reset at the authority's current position.
      if (batch.reset || first) return 'invalidate';
      return batch.changes.length ? 'changes' : 'ignore';
    },
  };
}

/**
 * Follow the authority's change stream until `signal` aborts, reconnecting after failures.
 * Starts from an unknown cursor, which the authority answers with a reset at its current
 * position, so no event between an earlier snapshot and this subscription can be missed.
 */
async function followStream(
  transport: Transport,
  apply: (batch: ChangeBatch) => void,
  signal: AbortSignal,
  retryMs: number,
) {
  let cursor = '';
  while (!signal.aborted) {
    try {
      for await (const batch of transport.events(cursor, signal)) {
        if (signal.aborted) return;
        cursor = batch.cursor;
        apply(batch);
      }
    } catch {
      if (signal.aborted) return;
    }
    cursor = '';
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, retryMs);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });
  }
}

/**
 * TanStack Query bindings for one authenticated transport (one authority, principal and grant).
 * Create one per signed-in session and discard it on sign-out; never share a cache across
 * principals. The bindings keep an authorization fence: a snapshot produced under an older
 * authorization revision than the stream has observed is rejected instead of cached, so a slow
 * response cannot restore data that a revocation removed.
 */
export function createLiveBindings(transport: Transport) {
  const fence = createAuthorizationFence();

  /** Query options for a capability. Data is the committed output; drafts stay in forms. */
  function liveQueryOptions<C extends AnyCapability>(
    capability: C & { kind: 'query' },
    input: InputOf<C>,
  ) {
    // Canonical JSON both validates the input is JSON and gives a stable key across renders.
    const key = canonicalJson(input);
    return queryOptions({
      queryKey: [CAPABILITY_QUERY_KEY, capability.id, key] as const,
      queryFn: async ({ signal }) =>
        fence.admit(await transport.query<OutputOf<C>>(capability.id, JSON.parse(key), signal)),
      select: (snapshot: Snapshot<OutputOf<C>>) => snapshot.data,
      meta: {
        capability: capability.id,
        ...(capability.dependencies ? { dependencies: capability.dependencies } : {}),
      } satisfies CapabilityQueryMeta,
      // Freshness comes from the change stream, not from timers or window focus.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 2,
    });
  }

  /**
   * Apply one change batch. Changes coalesce into a single invalidation per batch and refetch
   * only active queries whose declared dependencies intersect the changed resource types. A
   * reset invalidates everything; an authorization change resets cached data first, so screens
   * show loading rather than data the principal may no longer read.
   *
   * Every cache decision happens synchronously before the first await: the returned promise only
   * tracks the refetches, so a caller may drop it without delaying the reset.
   */
  async function applyBatch(queryClient: QueryClient, batch: ChangeBatch): Promise<void> {
    const filter = { queryKey: [CAPABILITY_QUERY_KEY] };
    const action = fence.observe(batch);
    if (action === 'reset') return queryClient.resetQueries(filter);
    if (action === 'invalidate') return queryClient.invalidateQueries(filter);
    if (action === 'ignore') return;
    const types = changedResourceTypes(batch);
    await queryClient.invalidateQueries({
      ...filter,
      predicate: (query) =>
        isAffected((query.meta as CapabilityQueryMeta | undefined)?.dependencies, types),
    });
  }

  /** Follow the change stream into `queryClient` until `signal` aborts. */
  function follow(queryClient: QueryClient, signal: AbortSignal, retryMs = 500) {
    // Not awaited: a refetch that never answers must not hold back a later revocation.
    // applyBatch changes the cache before its first await, so batches still apply in order.
    return followStream(transport, (batch) => void applyBatch(queryClient, batch), signal, retryMs);
  }

  /** One change subscription per mounted application, shared by every capability query. */
  function useLiveInvalidation(queryClient: QueryClient) {
    useEffect(() => {
      const controller = new AbortController();
      void follow(queryClient, controller.signal);
      return () => controller.abort();
    }, [queryClient]);
  }

  return { liveQueryOptions, applyBatch, follow, useLiveInvalidation };
}
export type LiveBindings = ReturnType<typeof createLiveBindings>;
