import type { AuditOutcome, EventLogPort } from '@agent-native/contracts';
import type { ResolvedPolicy } from '@agent-native/site/policy';
import {
  readEvents,
  verifyEventLog,
  type ChainHead,
  type ForwardingStats,
} from '@agent-native/event-log';
import { auditEvents } from './audit-events';
import type { AuditEventView, LogVerification, Posture } from './contracts';
import { accumulateEgress, assessPosture, type EgressUsage } from './posture';

/** What the compliance capabilities read. Implemented by the posture monitor. */
export interface CompliancePort {
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
  /** The running build's best-before date, when it carries one. */
  readonly bestBefore?: string;
  /** Re-check cadence. Default 15 minutes; each check re-verifies the whole chain. */
  readonly intervalMs?: number;
  /** A posture read older than this triggers a new check. Default one minute. */
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

const egressKinds = ['egress.allowed', 'egress.denied'];

/** Verify the chain up to the writer's head, which is read first. */
async function verifyToHead(options: PostureMonitorOptions) {
  const head = options.head();
  return { head, report: await verifyEventLog(options.directory, { head }) };
}

/** Usage folded so far and the sequence it covers; each check reads only newer events. */
interface UsageState {
  usage: ReadonlyMap<string, EgressUsage>;
  scanned: number;
}

/** One check: verify, fold new egress, assess, then record `posture.checked` (best effort). */
async function runCheck(
  options: PostureMonitorOptions,
  state: UsageState,
  now: () => number,
): Promise<Posture> {
  const { head, report } = await verifyToHead(options);
  const fresh = (
    await readEvents(options.directory, { afterSeq: state.scanned, kinds: egressKinds })
  ).filter((event) => event.seq <= head.seq);
  state.usage = accumulateEgress(state.usage, fresh);
  state.scanned = head.seq;
  const posture = assessPosture({
    policy: options.policy,
    verification: report,
    ...(options.forwarding?.() ? { forwarding: options.forwarding()! } : {}),
    usage: state.usage,
    ...(options.attestation ? { attestation: await options.attestation() } : {}),
    ...(options.bestBefore ? { bestBefore: options.bestBefore } : {}),
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
  return posture;
}

async function verification(options: PostureMonitorOptions): Promise<LogVerification> {
  const { head, report } = await verifyToHead(options);
  return {
    ok: report.ok,
    segments: report.segments,
    events: report.events,
    checkpoints: report.checkpoints,
    headSeq: head.seq,
    problems: report.problems.slice(0, 50).map((problem) => ({ ...problem })),
  };
}

/**
 * Continuous, passive posture monitoring for a running instance. Each check verifies the
 * chain up to the writer's head, folds new egress events into per-destination usage, assesses
 * the posture and records `posture.checked` (best effort: monitoring never blocks the app).
 * Reads scan the log files, which suits the reference scale; a large deployment would index.
 */
export function createPostureMonitor(options: PostureMonitorOptions) {
  const now = options.now ?? Date.now;
  const state: UsageState = { usage: new Map(), scanned: 0 };
  let latest: Posture | undefined;
  let running: Promise<Posture> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** One check at a time; concurrent callers share the running one. */
  const check = () =>
    (running ??= runCheck(options, state, now)
      .then((posture) => (latest = posture))
      .finally(() => {
        running = undefined;
      }));

  const port: CompliancePort = {
    // Reuse a recent check; an older one is redone so a reader never sees stale posture.
    posture: async () =>
      latest && now() - latest.checkedAt < (options.maxAgeMs ?? 60_000) ? latest : check(),
    events: async (query) => auditEvents(options.directory, options.head(), query),
    verify: () => verification(options),
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
