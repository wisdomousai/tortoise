import { createHash } from 'node:crypto';
import {
  AUDIT_GENESIS,
  canonicalJson,
  isAuditKind,
  type AuditEvent,
  type AuditRecord,
  type JsonObject,
} from '@agent-native/contracts';

export interface ChainHead {
  readonly seq: number;
  readonly hash: string;
}
export const genesisHead: ChainHead = Object.freeze({ seq: 0, hash: AUDIT_GENESIS });

export interface EventSource {
  readonly component: string;
  readonly instance: string;
}

/** Drop `undefined` members so events are canonical JSON; absent and undefined are the same. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        key,
        item !== null && typeof item === 'object' && !Array.isArray(item) ? compact(item) : item,
      ]),
  ) as T;
}

/** SHA-256 over the previous hash and the canonical JSON of the event without its own hash. */
export function hashEvent(event: Omit<AuditEvent, 'hash'>): string {
  return createHash('sha256')
    .update(event.prev)
    .update('\n')
    .update(canonicalJson(event))
    .digest('hex');
}

/**
 * Assign sequence numbers, time, source and chain links. Rejects malformed kinds before anything
 * is written, so one bad record cannot leave a partial batch.
 */
export function sealEvents(
  records: readonly AuditRecord[],
  head: ChainHead,
  source: EventSource,
  now: () => number,
): AuditEvent[] {
  let { seq, hash: prev } = head;
  return records.map((record) => {
    if (!isAuditKind(record.kind)) throw new Error(`Invalid audit event kind: ${record.kind}`);
    const unsealed = compact({
      ...record,
      seq: ++seq,
      at: record.at ?? now(),
      source,
      prev,
    }) as Omit<AuditEvent, 'hash'>;
    // Validates that every member is JSON; a non-JSON value would make the chain unverifiable.
    canonicalJson(unsealed as unknown as JsonObject);
    const event: AuditEvent = { ...unsealed, hash: hashEvent(unsealed) };
    prev = event.hash;
    return event;
  });
}

/** SHA-256 of the canonical JSON of `value`, for input digests and attestation. */
export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Serialize appends so sequence numbers and chain links follow call order. */
export function serialized(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
}
