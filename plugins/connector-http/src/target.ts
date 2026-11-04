import {
  DeliveryFailure,
  type DeliveryResult,
  type LookupResult,
  type PullBatch,
  type SystemOfRecordPort,
} from '@tortoise/integration';
import type { NetworkPort } from '@tortoise/kernel/plugin';
import type { Effect } from '@tortoise/runtime';
import { readPointer } from './pointer';

/**
 * How the system reports a refusal, as data: which statuses are business rejections and where
 * their code and message are in the body. Any status not listed here and not 2xx is transient.
 */
export interface RejectionRule {
  readonly status: readonly number[];
  /** JSON pointer to the code in the body, or the fixed code when it does not start with `/`. */
  readonly code: string;
  /** JSON pointer to the message in the body. */
  readonly message?: string;
}

/** What a request for one effect is: a refusal before sending, or the path and body to send. */
export type HttpRequestFor =
  | { readonly rejected: { readonly code: string; readonly message: string } }
  | { readonly method?: string; readonly path: string; readonly body: unknown };

export interface HttpTargetOptions<Item> {
  readonly target: string;
  readonly network: NetworkPort;
  /** The declared outbound destination that carries this target; the deployment policy binds its URL. */
  readonly destination: string;
  readonly request: (effect: Readonly<Effect>) => HttpRequestFor;
  /**
   * Header the system deduplicates on. With it, a resend under the same effect ID cannot create
   * a second record, so delivery is idempotent; without it, `lookup` is required.
   */
  readonly idempotencyHeader?: string;
  readonly rejections?: readonly RejectionRule[];
  /** JSON pointer to the system's reference for an accepted record. */
  readonly externalRef?: string;
  /** Statuses that acknowledge without deciding, such as 202 for an approval queue. */
  readonly pendingStatus?: readonly number[];
  /**
   * Find an earlier delivery by effect ID: a GET whose 200 response is the record (accepted, or
   * pending when `pendingWhen` matches), 404 no trace, and any other response transient.
   */
  readonly lookup?: {
    readonly path: (effectId: string) => string;
    readonly pendingWhen?: (body: unknown) => boolean;
  };
  /** Inbound changes: a GET page of items after a cursor. */
  readonly feed?: {
    readonly path: (cursor: string | undefined) => string;
    /** JSON pointers into the page. */
    readonly items: string;
    readonly cursor: string;
    readonly more?: string;
    readonly map: (item: unknown) => Item;
  };
  /** Per request. Default 30 000 ms. */
  readonly timeoutMs?: number;
}

const transient = (status: number) => new DeliveryFailure(`The system returned ${status}`);

async function bodyOf(response: Response): Promise<unknown> {
  // A reply cut off mid-body is as unknown as one never received.
  const text = await response.text().catch(() => {
    throw new DeliveryFailure('The reply was cut off');
  });
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const textAt = (body: unknown, pointer: string | undefined, limit: number) => {
  if (pointer === undefined) return undefined;
  const value = pointer.startsWith('/') ? readPointer(body, pointer) : pointer;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).slice(0, limit)
    : undefined;
};

/**
 * A REST system of record through the network port. Every request goes to the declared
 * destination, so the network guard sees it and the deployment policy decides its address.
 *
 * Outcomes are data: a 2xx is accepted (or pending for `pendingStatus`), a status a rejection
 * rule lists is rejected with the code and message it names, and everything else, including a
 * dropped connection, throws a transient failure. A transient failure after the request may
 * have been received is safe to resend only because the idempotency header or the lookup before
 * resend finds the earlier request, so one of the two is required.
 */
export function httpTargetPort<Item = unknown>(
  options: HttpTargetOptions<Item>,
): SystemOfRecordPort<Item> {
  if (!options.idempotencyHeader && !options.lookup)
    throw new Error(
      `HTTP target ${options.target} needs an idempotency header or a lookup, or a resend could create a second record`,
    );
  const timeoutMs = options.timeoutMs ?? 30_000;
  const client = () => options.network.client(options.destination);

  async function send(path: string, init: RequestInit, signal: AbortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await client().fetch(path, { ...init, signal: AbortSignal.any([signal, timeout]) });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new DeliveryFailure(
        timeout.aborted
          ? `${options.target} did not respond within ${timeoutMs} ms`
          : `${options.target} could not be reached`,
      );
    }
  }

  function rejection(status: number, body: unknown) {
    const rule = options.rejections?.find((candidate) => candidate.status.includes(status));
    if (!rule) return undefined;
    return {
      status: 'rejected' as const,
      code: textAt(body, rule.code, 100) ?? `HTTP_${status}`,
      message: textAt(body, rule.message, 500) ?? `The system refused the record (${status})`,
    };
  }

  const accepted = (body: unknown) => {
    const externalRef = textAt(body, options.externalRef, 200);
    return { status: 'accepted' as const, ...(externalRef ? { externalRef } : {}) };
  };

  const pull = options.feed
    ? async (cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<Item>> => {
        const feed = options.feed!;
        const response = await send(feed.path(cursor), { method: 'GET' }, signal);
        if (!response.ok) throw transient(response.status);
        const body = await bodyOf(response);
        const items = readPointer(body, feed.items);
        const next = readPointer(body, feed.cursor);
        if (!Array.isArray(items) || typeof next !== 'string')
          throw new DeliveryFailure(
            `${options.target} returned a feed page without items or a cursor`,
          );
        const more = feed.more ? readPointer(body, feed.more) === true : false;
        return { items: items.map(feed.map), cursor: next, more };
      }
    : undefined;

  return {
    describe: () => ({
      target: options.target,
      idempotentDelivery: Boolean(options.idempotencyHeader),
    }),
    async deliver(effect, signal): Promise<DeliveryResult> {
      signal.throwIfAborted();
      const request = options.request(effect);
      if ('rejected' in request) return { status: 'rejected', ...request.rejected };
      const response = await send(
        request.path,
        {
          method: request.method ?? 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.idempotencyHeader ? { [options.idempotencyHeader]: effect.id } : {}),
          },
          body: JSON.stringify(request.body),
        },
        signal,
      );
      const body = await bodyOf(response);
      if (options.pendingStatus?.includes(response.status)) {
        const externalRef = textAt(body, options.externalRef, 200);
        return { status: 'pending', ...(externalRef ? { externalRef } : {}) };
      }
      if (response.ok) return accepted(body);
      const refused = rejection(response.status, body);
      if (refused) return refused;
      throw transient(response.status);
    },
    ...(options.lookup
      ? {
          async lookup(effectId: string, signal: AbortSignal): Promise<LookupResult> {
            const response = await send(options.lookup!.path(effectId), { method: 'GET' }, signal);
            if (response.status === 404) return undefined;
            const body = await bodyOf(response);
            if (!response.ok) throw transient(response.status);
            if (options.lookup!.pendingWhen?.(body)) {
              const externalRef = textAt(body, options.externalRef, 200);
              return { status: 'pending', ...(externalRef ? { externalRef } : {}) };
            }
            return rejection(response.status, body) ?? accepted(body);
          },
        }
      : {}),
    ...(pull ? { pull } : {}),
  };
}
