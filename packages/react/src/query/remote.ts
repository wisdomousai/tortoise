import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import type { Snapshot, Transport } from '@tortoise/client';
import { CAPABILITY_QUERY_KEY, type CapabilityQueryMeta, type SnapshotFence } from './keys';

/** How long a remote result counts as fresh before revisiting the same input refetches it. */
export const REMOTE_STALE_MS = 30_000;

/** A capability that declares `remote`. */
export type RemoteQuery = AnyCapability & { kind: 'query'; remote: object };

const meta = (capability: RemoteQuery) =>
  ({ capability: capability.id, remote: true }) satisfies CapabilityQueryMeta;

/**
 * Query options for a remote query (a capability that declares `remote`), for example a
 * provider's search box. The result is point-in-time: it carries `source.fetchedAt` and
 * `source.status`, is fresh for `REMOTE_STALE_MS`, and keeps showing the previous input's
 * result while the next one loads, so typing does not flash empty lists. Local changes never
 * refetch it (that would call the target on every commit); an authorization change resets it
 * like any capability query. TanStack aborts superseded requests through `signal`, which the
 * runtime passes on to the source. Debounce the input in the screen.
 */
export function remoteQueryOptions<C extends RemoteQuery>(
  transport: Transport,
  fence: SnapshotFence,
  capability: C,
  input: InputOf<C>,
) {
  const key = canonicalJson(input);
  return queryOptions({
    queryKey: [CAPABILITY_QUERY_KEY, capability.id, key] as const,
    queryFn: async ({ signal }) =>
      fence.admit(await transport.query<OutputOf<C>>(capability.id, JSON.parse(key), signal)),
    select: (snapshot: Snapshot<OutputOf<C>>) => snapshot.data,
    meta: meta(capability),
    placeholderData: keepPreviousData,
    staleTime: REMOTE_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Infinite query options for a paged remote query: each page asks the source again with the
 * previous page's `next` as `cursor`, and `fetchNextPage` stops when a page has no `next`. Data
 * is the list of page outputs, in order; a page may be short or empty after local scoping, and
 * each carries its own `source` status. Freshness, placeholder and invalidation behave as in
 * `remoteQueryOptions`. A refetch replays the stored cursors, so a source whose cursors expire
 * returns an error for it, and the screen offers a new search.
 */
export function remoteInfiniteQueryOptions<C extends RemoteQuery>(
  transport: Transport,
  fence: SnapshotFence,
  capability: C,
  input: Omit<InputOf<C>, 'cursor'>,
) {
  const key = canonicalJson(input);
  return infiniteQueryOptions({
    queryKey: [CAPABILITY_QUERY_KEY, capability.id, key, 'pages'] as const,
    queryFn: async ({ pageParam, signal }) => {
      // An empty page parameter is the first page; TanStack needs a serializable initial value.
      const page = { ...JSON.parse(key), ...(pageParam ? { cursor: pageParam } : {}) };
      return fence.admit(await transport.query<OutputOf<C>>(capability.id, page, signal));
    },
    initialPageParam: '',
    getNextPageParam: (last: Snapshot<OutputOf<C>>) => (last.data as { next?: string }).next,
    select: (data) => data.pages.map((page) => page.data),
    meta: meta(capability),
    placeholderData: keepPreviousData,
    staleTime: REMOTE_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
