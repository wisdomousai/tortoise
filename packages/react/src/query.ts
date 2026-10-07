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

/**
 * TanStack Query bindings for one authenticated transport (one authority, principal and grant).
 * Create one per signed-in session and discard it on sign-out; never share a cache across
 * principals. The bindings keep an authorization fence: a snapshot produced under an older
 * authorization revision than the stream has observed is rejected instead of cached, so a slow
 * response cannot restore data that a revocation removed.
 */
export function createLiveBindings(transport: Transport) {
  // Highest revision seen anywhere; older snapshots are rejected instead of cached.
  let fenceRevision = -1;
  // Revision last applied from the stream; a higher one resets every cached query, including
  // queries whose own snapshot already reached it (other entries may predate the change).
  let streamRevision = -1;
  const fence = <T>(snapshot: Snapshot<T>): Snapshot<T> => {
    if (snapshot.authorizationRevision < fenceRevision)
      throw new Error('Snapshot superseded by a permission change');
    fenceRevision = snapshot.authorizationRevision;
    return snapshot;
  };

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
        fence(await transport.query<OutputOf<C>>(capability.id, JSON.parse(key), signal)),
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
   */
  async function applyBatch(queryClient: QueryClient, batch: ChangeBatch): Promise<void> {
    const previous = streamRevision;
    if (batch.authorizationRevision < previous) return;
    streamRevision = batch.authorizationRevision;
    fenceRevision = Math.max(fenceRevision, streamRevision);
    const filter = { queryKey: [CAPABILITY_QUERY_KEY] };
    if (previous >= 0 && streamRevision > previous) return queryClient.resetQueries(filter);
    // A stream's first batch is a reset at the authority's current position.
    if (batch.reset || previous < 0) return queryClient.invalidateQueries(filter);
    if (!batch.changes.length) return;
    const types = changedResourceTypes(batch);
    await queryClient.invalidateQueries({
      ...filter,
      predicate: (query) =>
        isAffected((query.meta as CapabilityQueryMeta | undefined)?.dependencies, types),
    });
  }

  /**
   * Follow the authority's change stream until `signal` aborts, reconnecting after failures.
   * Starts from an unknown cursor, which the authority answers with a reset at its current
   * position, so no event between an earlier snapshot and this subscription can be missed.
   */
  async function follow(queryClient: QueryClient, signal: AbortSignal, retryMs = 500) {
    let cursor = '';
    while (!signal.aborted) {
      try {
        for await (const batch of transport.events(cursor, signal)) {
          if (signal.aborted) return;
          cursor = batch.cursor;
          await applyBatch(queryClient, batch);
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
