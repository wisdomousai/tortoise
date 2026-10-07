import type { AuditEvent, AuditRecord, EventLogPort } from '@agent-native/contracts';

/** Ships sealed events somewhere else, for example an off-host syslog collector. */
export type EventSink = (events: readonly AuditEvent[]) => Promise<void>;

export interface ForwardingStats {
  readonly forwarded: number;
  readonly dropped: number;
  readonly failures: number;
  readonly pending: number;
}
export interface ForwardingEventLog extends EventLogPort {
  stats(): ForwardingStats;
  /** Wait until queued events have been offered to the sink. */
  flush(): Promise<void>;
}

/**
 * Forward after the local append resolves, never inside it: the local, fsynced log is the
 * fail-closed record, and a slow or unreachable collector must not hold a storage transaction.
 * The queue is bounded; overflow and sink failures are counted and surface in posture checks.
 * Forwarded copies let an auditor compare the local chain head with an off-host one.
 */
export function forwardingEventLog(
  primary: EventLogPort,
  sink: EventSink,
  options: { readonly maxQueued?: number } = {},
): ForwardingEventLog {
  const maxQueued = options.maxQueued ?? 10_000;
  const queue: AuditEvent[] = [];
  let forwarded = 0;
  let dropped = 0;
  let failures = 0;
  let running: Promise<void> | undefined;
  const pump = (): Promise<void> =>
    (running ??= (async () => {
      while (queue.length) {
        const batch = queue.splice(0, 100);
        try {
          await sink(batch);
          forwarded += batch.length;
        } catch {
          failures++;
          dropped += batch.length;
        }
      }
      running = undefined;
    })());
  return {
    mode: primary.mode,
    async append(records: readonly AuditRecord[]) {
      const events = await primary.append(records);
      const room = Math.max(0, maxQueued - queue.length);
      queue.push(...events.slice(0, room));
      dropped += Math.max(0, events.length - room);
      void pump();
      return events;
    },
    stats: () => ({ forwarded, dropped, failures, pending: queue.length }),
    flush: async () => {
      while (queue.length || running) await pump();
    },
  };
}

const syslogEscape = (value: string) => value.replace(/[\\\]"]/g, (char) => `\\${char}`);
/**
 * Format an event as an RFC 5424 syslog message with the full event as JSON in the message
 * body (facility 13, log audit). Severity is warning for denials and failures, notice otherwise.
 */
export function rfc5424(
  event: AuditEvent,
  options: { readonly appName: string; readonly hostname: string },
): string {
  const severity = event.outcome === 'denied' || event.outcome === 'failed' ? 4 : 5;
  const priority = 13 * 8 + severity;
  const timestamp = new Date(event.at).toISOString();
  const data = `[audit@32473 seq="${event.seq}" kind="${syslogEscape(event.kind)}" hash="${event.hash}"]`;
  return `<${priority}>1 ${timestamp} ${options.hostname} ${options.appName} - ${event.kind} ${data} ${JSON.stringify(event)}`;
}
