import { readEvents } from '@agent-native/event-log';
import { fleetSiteOperations } from './contracts';
import type { FleetLink } from './link';

/** What the audit forwarder reads: the audit plugin's log directory and chain head. */
export interface AuditSource {
  readonly logDirectory: string;
  head(): { readonly seq: number };
}

const BATCH = 100;

/**
 * Send the fleet the audit events it does not hold yet, oldest first, up to `maxBatches` of 100.
 * The fleet says where its copy ends, so nothing is tracked here: a lost reply or a restart sends
 * the same events again, and the fleet accepts each sequence once. Events go as the JSON of the
 * local log, so the fleet can check the hash chain itself. Returns the fleet's last sequence.
 */
export async function forwardAudit(link: FleetLink, audit: AuditSource, maxBatches = 10) {
  let { afterSeq } = await link.query<{ afterSeq: number }>(fleetSiteOperations.auditCursor.id);
  const head = audit.head().seq;
  for (let batch = 0; batch < maxBatches && afterSeq < head; batch++) {
    const events = (await readEvents(audit.logDirectory, { afterSeq, limit: BATCH })).filter(
      (event) => event.seq <= head,
    );
    if (!events.length) break;
    ({ afterSeq } = await link.command<{ afterSeq: number }>(
      fleetSiteOperations.auditIngest.id,
      { events: events.map((event) => JSON.stringify(event)) },
      `audit:${events[0]!.seq}-${events.at(-1)!.seq}:${events.at(-1)!.hash}`,
    ));
  }
  return afterSeq;
}
