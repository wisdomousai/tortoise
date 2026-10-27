import type { AuditEvent, JsonValue } from '@agent-native/contracts';
import { hashEvent } from '@agent-native/event-log/chain';
import { fleetSiteOperations } from '@agent-native/fleet-agent/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { AUDIT_EVENTS_PER_SITE, auditEvents, type AuditEventRecord } from '../contracts/audit';
import { sites } from '../contracts/sites';
import type { AppState } from '../domain';
import { handler, type Context, type Services } from './context';
import { reportedSite } from './sites';

type List = typeof operations.auditEventList;
type Get = typeof operations.auditEventGet;
const store = (state: AppState) => state.auditEvents;
const visible = () => true;

const parse = (line: string): Partial<AuditEvent> | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Partial<AuditEvent>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Why `event` cannot follow `previous` in the site's chain, or undefined when it can. */
function breakIn(event: Partial<AuditEvent> | undefined, previous: { seq: number; hash: string }) {
  if (!event) return { at: previous.seq + 1, reason: 'is not a JSON object' };
  if (!Number.isSafeInteger(event.seq))
    return { at: previous.seq + 1, reason: 'has no sequence number' };
  if (event.seq !== previous.seq + 1)
    return { at: previous.seq + 1, reason: `is missing; event ${event.seq} was received instead` };
  const { hash, ...unsealed } = event as AuditEvent;
  if (event.prev !== previous.hash)
    return { at: event.seq!, reason: 'does not link to the event before it' };
  if (typeof hash !== 'string' || hashEvent(unsealed) !== hash)
    return { at: event.seq!, reason: 'does not match its hash' };
  return undefined;
}

/** Keep the newest events per site; older ones leave the fleet's copy, not the site's log. */
function prune(ctx: Context, site: string, newest: number) {
  const events = records(ctx, auditEvents, ctx.state.auditEvents);
  for (let seq = newest - AUDIT_EVENTS_PER_SITE; seq > 0; seq--) {
    if (!events.has(`${site}:${seq}`)) break;
    events.remove(`${site}:${seq}`);
  }
}

/**
 * Forwarded audit events. Each must follow the last one the fleet holds for that site: the next
 * sequence number, a `prev` equal to that event's hash, and its own hash over the event. The
 * first event that fails stops collection for the site, records why on the site, and commits,
 * so the break is visible instead of retried away. Events the fleet already holds are skipped:
 * a site reads the fleet's cursor before each batch, so a batch is repeated only when the reply to
 * a batch was lost after the fleet committed it.
 */
export function auditHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, AuditEventRecord>(
      auditEvents,
      operations.auditEventList,
      {
        store,
        visible,
        order: (a, b) => b.at - a.at || b.seq - a.seq,
        searchText: (event) => `${event.site} ${event.kind}`,
      },
    ),
    collectionGetHandler<AppState, Services, Get, AuditEventRecord>(
      auditEvents,
      operations.auditEventGet,
      { store, visible },
    ),
    handler(fleetSiteOperations.auditCursor, (_input, ctx) => ({
      afterSeq: reportedSite(ctx).auditSeq,
    })),
    handler(fleetSiteOperations.auditIngest, (input, ctx) => {
      const site = reportedSite(ctx);
      if (site.auditBroken) return { afterSeq: site.auditSeq };
      const events = records(ctx, auditEvents, ctx.state.auditEvents);
      let head = { seq: site.auditSeq, hash: site.auditHash };
      let broken: string | undefined;
      for (const line of input.events) {
        const parsed = parse(line);
        if (typeof parsed?.seq === 'number' && parsed.seq <= head.seq) continue;
        const problem = breakIn(parsed, head);
        if (problem) {
          broken = `Audit event ${problem.at} ${problem.reason}`;
          break;
        }
        const event = parsed as AuditEvent;
        events.insert(`${site.id}:${event.seq}`, {
          id: `${site.id}:${event.seq}`,
          site: site.id,
          seq: event.seq,
          kind: event.kind,
          at: event.at,
          hash: event.hash,
          event: event as unknown as JsonValue,
        });
        head = { seq: event.seq, hash: event.hash };
      }
      records(ctx, sites, ctx.state.sites).update(site.id, (record) => {
        record.auditSeq = head.seq;
        record.auditHash = head.hash;
        if (broken) record.auditBroken = broken;
      });
      prune(ctx, site.id, head.seq);
      return { afterSeq: head.seq };
    }),
  ];
}
