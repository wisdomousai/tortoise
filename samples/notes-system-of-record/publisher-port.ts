import { httpTargetPort } from '@agent-native/connector-http';
import type { NetworkPort } from '@agent-native/host/plugin';
import { PUBLISHER_DESTINATION, publisherTarget, type PostedNote } from './contracts';

/**
 * The publisher's REST API as data. It deduplicates on `Idempotency-Key`, so a resend after a
 * lost reply cannot publish twice. 422 is a business rejection. 202 means queued for moderation:
 * the dispatcher polls the lookup until the publisher decides, and holds the effect when the
 * lookup no longer finds a publication it acknowledged.
 */
export function publisherPort(network: NetworkPort) {
  return httpTargetPort<PostedNote>({
    target: publisherTarget.target,
    network,
    destination: PUBLISHER_DESTINATION,
    request: (effect) => ({ path: '/publications', body: effect.payload }),
    idempotencyHeader: 'Idempotency-Key',
    rejections: [{ status: [422], code: '/error/code', message: '/error/message' }],
    externalRef: '/id',
    pendingStatus: [202],
    lookup: {
      path: (effectId) => `/publications/by-key/${encodeURIComponent(effectId)}`,
      pendingWhen: (body) => (body as { state?: unknown } | undefined)?.state === 'review',
    },
    feed: {
      path: (cursor) => `/changes?after=${cursor ?? ''}`,
      items: '/items',
      cursor: '/cursor',
      more: '/more',
      map: (item) => item as PostedNote,
    },
    timeoutMs: 5_000,
  });
}
