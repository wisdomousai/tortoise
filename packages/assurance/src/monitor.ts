import type { AuditEvent, AuditOutcome, EventLogPort } from '@agent-native/contracts';
import type { ResolvedPolicy } from '@agent-native/egress';
import {
  readEvents,
  verifyEventLog,
  type ChainHead,
  type ForwardingStats,
} from '@agent-native/event-log';
import type { AuditEventView, LogVerification, Posture } from './contracts';
import { accumulateEgress, assessPosture, type EgressUsage } from './posture';

/** What the assurance capabilities read. Implemented by the posture monitor. */
export interface AssurancePort {
  posture(): Promise<Posture>;
  events(query: {
    readonly afterSeq?: number;
    readonly limit?: number;
    readonly kinds?: readonly string[];
    readonly outcome?: AuditOutcome;
    readonly newest?: boolean;
  }): Promise<{ items: AuditEventView[]; nextAfterSeq: number; headSeq: number }>;
  verify(): Promise<LogVerification>;
}

export interface PostureMonitorOptions {
  readonly policy: ResolvedPolicy;
  /** Directory of the JSON-lines log the running process writes. */
  readonly directory: string;
  /** The writer's current head; verification stops there, so live appends are never misread. */
  readonly head: () => ChainHead;
  /** Where `posture.checked` is recorded. */
  readonly eventLog: EventLogPort;
  readonly forwarding?: () => ForwardingStats | undefined;
  readonly attestation?: () => Promise<{ catalogDigest?: string; executableDigest?: string }>;
  /** Re-check cadence. Default 15 minutes; each check re-verifies the whole chain. */
  readonly intervalMs?: number;
  /** A posture read older than this triggers a new check. Default one minute. */
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

const egressKinds = ['egress.allowed', 'egress.denied'];

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

/**
 * Continuous, passive posture monitoring for a running authority. Each check verifies the
 * chain up to the writer's head, folds new egress events into per-destination usage, assesses
 * the posture and records `posture.checked` (best effort: monitoring never blocks the app).
 * Reads scan the log files, which suits the reference scale; a large deployment would index.
 */
export function createPostureMonitor(options: PostureMonitorOptions) {
  const now = options.now ?? Date.now;
  let usage: ReadonlyMap<string, EgressUsage> = new Map();
  let scanned = 0;
  let latest: Posture | undefined;
  let running: Promise<Posture> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function verify() {
    const head = options.head();
    return { head, report: await verifyEventLog(options.directory, { head }) };
  }

  async function runCheck(): Promise<Posture> {
    const { head, report } = await verify();
    const fresh = (
      await readEvents(options.directory, { afterSeq: scanned, kinds: egressKinds })
    ).filter((event) => event.seq <= head.seq);
    usage = accumulateEgress(usage, fresh);
    scanned = head.seq;
    const posture = assessPosture({
      policy: options.policy,
      verification: report,
      ...(options.forwarding?.() ? { forwarding: options.forwarding()! } : {}),
      usage,
      ...(options.attestation ? { attestation: await options.attestation() } : {}),
      now: now(),
    });
    await options.eventLog
      .append([
        {
          kind: 'posture.checked',
          outcome: 'info',
          data: {
            status: posture.status,
            headSeq: head.seq,
            checks: posture.checks.map((check) => ({ id: check.id, status: check.status })),
          },
        },
      ])
      .catch(() => undefined);
    latest = posture;
    return posture;
  }

  /** One check at a time; concurrent callers share the running one. */
  const check = () =>
    (running ??= runCheck().finally(() => {
      running = undefined;
    }));

  const port: AssurancePort = {
    // Reuse a recent check; an older one is redone so a reader never sees stale posture.
    posture: async () =>
      latest && now() - latest.checkedAt < (options.maxAgeMs ?? 60_000) ? latest : check(),
    async events(query) {
      const head = options.head();
      const limit = query.limit ?? 50;
      if (query.newest) {
        const matching = (
          await readEvents(options.directory, {
            ...(query.kinds?.length ? { kinds: query.kinds } : {}),
          })
        ).filter(
          (event) => event.seq <= head.seq && (!query.outcome || event.outcome === query.outcome),
        );
        return {
          items: matching.slice(-limit).map(view),
          nextAfterSeq: head.seq,
          headSeq: head.seq,
        };
      }
      const items: AuditEvent[] = [];
      let after = query.afterSeq ?? 0;
      // Page until enough matching events or the head; the outcome filter is applied per page.
      while (items.length < limit && after < head.seq) {
        const page = (
          await readEvents(options.directory, {
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
    },
    async verify() {
      const { head, report } = await verify();
      return {
        ok: report.ok,
        segments: report.segments,
        events: report.events,
        checkpoints: report.checkpoints,
        headSeq: head.seq,
        problems: report.problems.slice(0, 50).map((problem) => ({ ...problem })),
      };
    },
  };

  return {
    ...port,
    check,
    latest: () => latest,
    /** Check now, then on the interval. Failures are kept out of the request path. */
    start() {
      void check().catch(() => undefined);
      timer ??= setInterval(
        () => void check().catch(() => undefined),
        options.intervalMs ?? 15 * 60_000,
      );
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await running?.catch(() => undefined);
    },
  };
}
export type PostureMonitor = ReturnType<typeof createPostureMonitor>;
