import type { AuditOutcome, EventLogPort } from '@tortoise/contracts';
import type { ResolvedPolicy } from '@tortoise/deployment/policy';
import {
  readEvents,
  verifyEventLog,
  type ChainHead,
  type ForwardingStats,
} from '@tortoise/event-log';
import { auditEvents } from './audit-events';
import type { AuditEventView, LogVerification, ComplianceStatus } from './contracts';
import { accumulateNetworkUsage, assessCompliance, type NetworkUsage } from './status';

/** What the compliance capabilities read. Implemented by the compliance monitor. */
export interface CompliancePort {
  status(): Promise<ComplianceStatus>;
  events(query: {
    readonly afterSeq?: number;
    readonly limit?: number;
    readonly kinds?: readonly string[];
    readonly outcome?: AuditOutcome;
    readonly newest?: boolean;
  }): Promise<{ items: AuditEventView[]; nextAfterSeq: number; headSeq: number }>;
  verify(): Promise<LogVerification>;
}

export interface ComplianceMonitorOptions {
  readonly policy: ResolvedPolicy;
  /** Directory of the JSON-lines log the running process writes. */
  readonly directory: string;
  /** The writer's current head; verification stops there, so live appends are never misread. */
  readonly head: () => ChainHead;
  /** Where `compliance.checked` is recorded. */
  readonly eventLog: EventLogPort;
  readonly forwarding?: () => ForwardingStats | undefined;
  readonly attestation?: () => Promise<{ catalogDigest?: string; executableDigest?: string }>;
  /** The running build's best-before date, when it carries one. */
  readonly bestBefore?: string;
  /** Re-check cadence. Default 15 minutes; each check re-verifies the whole chain. */
  readonly intervalMs?: number;
  /** A compliance status read older than this triggers a new check. Default one minute. */
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

const networkKinds = ['network.allowed', 'network.denied'];

/** Verify the chain up to the writer's head, which is read first. */
async function verifyToHead(options: ComplianceMonitorOptions) {
  const head = options.head();
  return { head, report: await verifyEventLog(options.directory, { head }) };
}

/** Usage folded so far and the sequence it covers; each check reads only newer events. */
interface UsageState {
  usage: ReadonlyMap<string, NetworkUsage>;
  scanned: number;
}

/** One check: verify, fold new network events, assess, then record `compliance.checked` (best effort). */
async function runCheck(
  options: ComplianceMonitorOptions,
  state: UsageState,
  now: () => number,
): Promise<ComplianceStatus> {
  const { head, report } = await verifyToHead(options);
  const fresh = (
    await readEvents(options.directory, { afterSeq: state.scanned, kinds: networkKinds })
  ).filter((event) => event.seq <= head.seq);
  state.usage = accumulateNetworkUsage(state.usage, fresh);
  state.scanned = head.seq;
  const compliance = assessCompliance({
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
        kind: 'compliance.checked',
        outcome: 'info',
        data: {
          status: compliance.status,
          headSeq: head.seq,
          checks: compliance.checks.map((check) => ({ id: check.id, status: check.status })),
        },
      },
    ])
    .catch(() => undefined);
  return compliance;
}

async function verification(options: ComplianceMonitorOptions): Promise<LogVerification> {
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
 * Continuous, passive compliance monitoring for a running instance. Each check verifies the
 * chain up to the writer's head, folds new network events into per-destination usage, assesses
 * the compliance status and records `compliance.checked` (best effort: monitoring never blocks the app).
 * Reads scan the log files, which suits the reference scale; a large deployment would index.
 */
export function createComplianceMonitor(options: ComplianceMonitorOptions) {
  const now = options.now ?? Date.now;
  const state: UsageState = { usage: new Map(), scanned: 0 };
  let latest: ComplianceStatus | undefined;
  let running: Promise<ComplianceStatus> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** One check at a time; concurrent callers share the running one. */
  const check = () =>
    (running ??= runCheck(options, state, now)
      .then((compliance) => (latest = compliance))
      .finally(() => {
        running = undefined;
      }));

  const port: CompliancePort = {
    // Reuse a recent check; an older one is redone so a reader never sees stale compliance status.
    status: async () =>
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
export type ComplianceMonitor = ReturnType<typeof createComplianceMonitor>;
