import { queryOptions } from '@tanstack/react-query';
import {
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import type { Snapshot, Transport } from '@tortoise/client';
import { CAPABILITY_QUERY_KEY, type CapabilityQueryMeta, type SnapshotFence } from './keys';

/**
 * Query options for a local capability query. Data is the committed output; drafts stay in
 * forms. Freshness comes from the change stream, not from timers or window focus: the query is
 * refetched when a change batch touches one of its declared dependencies.
 */
export function liveQueryOptions<C extends AnyCapability>(
  transport: Transport,
  fence: SnapshotFence,
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
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
