import { httpTargetPort } from '@tortoise/connector-http';
import type { NetworkPort } from '@tortoise/host/plugin';
import { LIMS_DESTINATION, limsTarget, type RegisteredRequest } from './contracts';

/**
 * The LIMS REST API as data. It deduplicates on `Idempotency-Key`, so a resend after a lost
 * reply cannot register a request twice. 422 is a business rejection. 202 means queued for the
 * lab manager's review: the dispatcher polls the lookup until the LIMS decides, and holds the
 * effect when the lookup no longer finds a registration it acknowledged.
 */
export function limsPort(network: NetworkPort) {
  return httpTargetPort<RegisteredRequest>({
    target: limsTarget.target,
    network,
    destination: LIMS_DESTINATION,
    request: (effect) => ({ path: '/requests', body: effect.payload }),
    idempotencyHeader: 'Idempotency-Key',
    rejections: [{ status: [422], code: '/error/code', message: '/error/message' }],
    externalRef: '/id',
    pendingStatus: [202],
    lookup: {
      path: (effectId) => `/requests/by-key/${encodeURIComponent(effectId)}`,
      pendingWhen: (body) => (body as { state?: unknown } | undefined)?.state === 'review',
    },
    inbound: {
      path: (cursor) => `/changes?after=${cursor ?? ''}`,
      items: '/items',
      cursor: '/cursor',
      more: '/more',
      map: (item) => item as RegisteredRequest,
    },
    timeoutMs: 5_000,
  });
}
