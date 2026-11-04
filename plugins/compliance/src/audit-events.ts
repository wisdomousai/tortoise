import type { AuditEvent } from '@tortoise/contracts';
import { readEvents, type ChainHead } from '@tortoise/event-log';
import type { AuditEventView } from './contracts';
import type { CompliancePort } from './monitor';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const isScalar = (value: unknown) => value === null || typeof value !== 'object';
const isFlatRecord = (value: unknown): value is Record<string, Json> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(isScalar);
const serialize = (value: unknown) => JSON.stringify(value);
/** Shape stored event data to the published two-level schema; deeper values become JSON text. */
function boundedEventData(data: Record<string, unknown>): AuditEventView['data'] {
  const nested = (value: unknown) =>
    isScalar(value) || (Array.isArray(value) && value.every(isScalar)) || isFlatRecord(value)
      ? value
      : serialize(value);
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      isScalar(value)
        ? value
        : Array.isArray(value)
          ? value.map((item) => (isScalar(item) || isFlatRecord(item) ? item : serialize(item)))
          : Object.fromEntries(
              Object.entries(value as Record<string, unknown>).map(([inner, item]) => [
                inner,
                nested(item),
              ]),
            ),
    ]),
  ) as AuditEventView['data'];
}
const view = (event: AuditEvent): AuditEventView =>
  (event.data ? { ...event, data: boundedEventData(event.data) } : event) as AuditEventView;

type EventQuery = Parameters<CompliancePort['events']>[0];

/** The newest matching events up to the head, oldest first. */
async function newestEvents(directory: string, head: ChainHead, query: EventQuery, limit: number) {
  const matching = (
    await readEvents(directory, {
      ...(query.kinds?.length ? { kinds: query.kinds } : {}),
    })
  ).filter((event) => event.seq <= head.seq && (!query.outcome || event.outcome === query.outcome));
  return {
    items: matching.slice(-limit).map(view),
    nextAfterSeq: head.seq,
    headSeq: head.seq,
  };
}

/**
 * A page of audit events after `afterSeq` (or the newest ones), never past the writer's head.
 * Event data is reshaped to the published two-level schema.
 */
export async function auditEvents(directory: string, head: ChainHead, query: EventQuery) {
  const limit = query.limit ?? 50;
  if (query.newest) return newestEvents(directory, head, query, limit);
  const items: AuditEvent[] = [];
  let after = query.afterSeq ?? 0;
  // Page until enough matching events or the head; the outcome filter is applied per page.
  while (items.length < limit && after < head.seq) {
    const page = (
      await readEvents(directory, {
        afterSeq: after,
        limit: Math.max(limit, 200),
        ...(query.kinds?.length ? { kinds: query.kinds } : {}),
      })
    ).filter((event) => event.seq <= head.seq);
    if (!page.length) {
      after = head.seq;
      break;
    }
    for (const event of page) {
      after = event.seq;
      if (!query.outcome || event.outcome === query.outcome) items.push(event);
      if (items.length === limit) break;
    }
  }
  return {
    items: items.map(view),
    nextAfterSeq: items.length === limit ? items.at(-1)!.seq : Math.max(after, head.seq),
    headSeq: head.seq,
  };
}
