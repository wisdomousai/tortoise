import { useEffect } from 'react';
import type { Query, QueryClient } from '@tanstack/react-query';
import type { AnyCapability, InputOf } from '@tortoise/contracts';
import type { ChangeBatch, Snapshot, Transport } from '@tortoise/client';
import { CAPABILITY_QUERY_KEY, type CapabilityQueryMeta } from './query/keys';
import { liveQueryOptions } from './query/live';
import { remoteInfiniteQueryOptions, remoteQueryOptions, type RemoteQuery } from './query/remote';

export { CAPABILITY_QUERY_KEY } from './query/keys';
export { REMOTE_STALE_MS } from './query/remote';

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

const isLocal = (query: Query) => !(query.meta as CapabilityQueryMeta | undefined)?.remote;

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
      // A stream's first batch is a reset at the instance's current position.
      if (batch.reset || first) return 'invalidate';
      return batch.changes.length ? 'changes' : 'ignore';
    },
  };
}

/**
 * Follow the instance's change stream until `signal` aborts, reconnecting after failures.
 * Starts from an unknown cursor, for which the instance returns a reset at its current
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
 * TanStack Query bindings for one authenticated transport (one instance, principal and grant).
 * Create one per signed-in session and discard it on sign-out; never share a cache across
 * principals. The bindings keep an authorization fence: a snapshot produced under an older
 * authorization revision than the stream has observed is rejected instead of cached, so a slow
 * response cannot restore data that a revocation removed.
 */
export function createLiveBindings(transport: Transport) {
  const fence = createAuthorizationFence();

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
    if (action === 'invalidate')
      return queryClient.invalidateQueries({ ...filter, predicate: isLocal });
    if (action === 'ignore') return;
    const types = changedResourceTypes(batch);
    await queryClient.invalidateQueries({
      ...filter,
      predicate: (query) =>
        isLocal(query) &&
        isAffected((query.meta as CapabilityQueryMeta | undefined)?.dependencies, types),
    });
  }

  /** Follow the change stream into `queryClient` until `signal` aborts. */
  function follow(queryClient: QueryClient, signal: AbortSignal, retryMs = 500) {
    // Not awaited: a refetch that never resolves must not hold back a later revocation.
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

  return {
    /** Query options for a capability. Data is the committed output; drafts stay in forms. */
    liveQueryOptions: <C extends AnyCapability>(
      capability: C & { kind: 'query' },
      input: InputOf<C>,
    ) => liveQueryOptions(transport, fence, capability, input),
    /** Live read of another system, fenced like local queries; see `query/remote`. */
    remoteQueryOptions: <C extends RemoteQuery>(capability: C, input: InputOf<C>) =>
      remoteQueryOptions(transport, fence, capability, input),
    /** The same read one page at a time, for "show more"; see `query/remote`. */
    remoteInfiniteQueryOptions: <C extends RemoteQuery>(
      capability: C,
      input: Omit<InputOf<C>, 'cursor'>,
    ) => remoteInfiniteQueryOptions(transport, fence, capability, input),
    applyBatch,
    follow,
    useLiveInvalidation,
  };
}
export type LiveBindings = ReturnType<typeof createLiveBindings>;
