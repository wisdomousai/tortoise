import type { EventNotification, InitializeAnswer } from '../protocol';

type Handler = (event: EventNotification, session: InitializeAnswer) => Promise<void> | void;

/**
 * Delivers driver events to one handler in order, one at a time, so a slow consumer (an ingest
 * command) never runs two events concurrently. Holds at most `limit` waiting events; beyond that
 * the oldest are dropped and reported. Tracks `seq` per session: an event from another session is
 * dropped, and a gap is reported with the number of events missed.
 */
export function createEventQueue(limit: number, report: (problem: string) => void) {
  const waiting: { event: EventNotification; session: InitializeAnswer; handler: Handler }[] = [];
  let current: string | undefined;
  let expected: number | undefined;
  let running: Promise<void> = Promise.resolve();
  let draining = false;

  async function drain() {
    draining = true;
    while (waiting.length) {
      const next = waiting.shift()!;
      try {
        await next.handler(next.event, next.session);
      } catch {
        report(`Handling driver event ${next.event.name} failed`);
      }
    }
    draining = false;
  }

  return {
    /** A new session starts its own sequence. */
    begin(session: string) {
      current = session;
      expected = undefined;
    },
    push(event: EventNotification, session: InitializeAnswer, handler: Handler | undefined) {
      if (event.session !== current) return report('Driver sent an event for another session');
      if (expected !== undefined && event.seq > expected)
        report(`Driver events ${expected} to ${event.seq - 1} were missed`);
      if (expected !== undefined && event.seq < expected)
        return report(`Driver repeated event ${event.seq}`);
      expected = event.seq + 1;
      if (!handler) return;
      if (waiting.length >= limit) {
        waiting.shift();
        report('Driver events arrive faster than they are handled; the oldest was dropped');
      }
      waiting.push({ event, session, handler });
      if (!draining) running = drain();
    },
    drained: () => running,
  };
}
