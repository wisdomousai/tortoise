import type {
  AttemptRecord,
  ClaimResult,
  CommandResult,
  Effect,
  EffectOutcome,
  ExecutionContext,
  Invocation,
} from '@tortoise/runtime';
import { createDelivery } from './dispatcher/delivery.js';
import { abortableSleep, createLoop } from './loop.js';
import type { SystemOfRecordPort } from './port.js';

/** Host-only application methods a dispatcher needs. Transports never expose the first two. */
export interface DispatcherApplication {
  pendingEffects(
    context: ExecutionContext,
    filter?: { readonly target?: string; readonly limit?: number; readonly includeHeld?: boolean },
  ): Promise<readonly Effect[]>;
  recordAttempt(
    context: ExecutionContext,
    id: string,
    failure: string,
    attempt?: AttemptRecord,
  ): Promise<Effect>;
  claimEffect(
    context: ExecutionContext,
    id: string,
    claim: { readonly worker: string; readonly leaseMs: number; readonly recheck?: boolean },
  ): Promise<ClaimResult>;
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandResult>;
}
export interface DispatchReport {
  accepted: number;
  rejected: number;
  retried: number;
  deferred: number;
  /** Effects whose outcome at the target is unknown; they wait for a reconciliation command. */
  held: number;
  /** Effects the target acknowledged without deciding; their lookup is polled. */
  acknowledged: number;
}
export interface EffectDispatcherOptions {
  readonly application: DispatcherApplication;
  readonly port: SystemOfRecordPort;
  /**
   * Trusted integration identity supplied by the host. Give it a grant limited to the completion
   * operation so a compromised port cannot call other business commands.
   */
  readonly context: ExecutionContext;
  /** Domain command that records an outcome through `ctx.completeEffect` and updates domain state. */
  readonly completeOperation: string;
  /**
   * The complete command's input; `{ effectId, outcome }` when omitted. To fence completions too,
   * include `attempt.fence` and pass it on to `ctx.completeEffect`, as `defineTarget` complete
   * commands do; without it only attempts are fenced.
   */
  readonly completeInput?: (
    effect: Readonly<Effect>,
    outcome: EffectOutcome,
    attempt: { readonly fence: number },
  ) => unknown;
  /**
   * This worker's identity in claims. Two dispatchers for one target must use different ones;
   * a random ID per dispatcher when omitted.
   */
  readonly worker?: string;
  /** How long a claim lasts before another worker may take the effect over. Default 120 s. */
  readonly leaseMs?: number;
  /**
   * Authorize the effect's original actor again before each first claim, holding the effect when
   * they lost the right to run its command. Default true.
   */
  readonly recheck?: boolean;
  /** Delay before retry after `attempts` failures. Defaults to exponential backoff capped at 60 s. */
  readonly backoff?: (attempts: number) => number;
  readonly batchSize?: number;
  /** Must match the application's clock, which stamps `lastAttemptAt`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Delivers committed outbox effects to one target outside every transaction, then records each
 * outcome through the domain's completion command. Delivery is at least once: duplicates are
 * prevented by the target deduplicating on the effect ID, or, for targets that cannot, by looking
 * up an earlier delivery before every send. A completion replay uses `complete:<effectId>` as its
 * idempotency key, so a lost completion response is safe to repeat.
 */
export function createEffectDispatcher(options: EffectDispatcherOptions) {
  const description = options.port.describe();
  if (!description.idempotentDelivery && !options.port.lookup)
    throw new Error(`Target ${description.target} needs lookup because delivery is not idempotent`);
  const now = options.now ?? Date.now;
  const backoff =
    options.backoff ?? ((attempts: number) => Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
  const dispatch = createDelivery(options, description, {
    worker: options.worker ?? crypto.randomUUID(),
    leaseMs: options.leaseMs ?? 120_000,
  });
  const pending = (limit?: number) =>
    options.application.pendingEffects(options.context, {
      target: description.target,
      ...(limit === undefined ? {} : { limit }),
    });

  async function runOnce(
    signal: AbortSignal = new AbortController().signal,
    { ignoreBackoff = false } = {},
  ): Promise<DispatchReport> {
    const report: DispatchReport = {
      accepted: 0,
      rejected: 0,
      retried: 0,
      deferred: 0,
      held: 0,
      acknowledged: 0,
    };
    for (const effect of await pending(options.batchSize ?? 50)) {
      if (signal.aborted) break;
      if (
        !ignoreBackoff &&
        effect.lastAttemptAt !== undefined &&
        now() < effect.lastAttemptAt + backoff(effect.attempts)
      ) {
        report.deferred++;
        continue;
      }
      const step = await dispatch(effect, signal);
      if (step.countAs) report[step.countAs]++;
      if (step.stop) break;
    }
    return report;
  }

  /**
   * Deliver until nothing is pending or the timeout passes, ignoring backoff. Returns the number of
   * effects still awaiting delivery; held effects await reconciliation and effects the target
   * acknowledged await its decision, so neither is counted. An
   * ephemeral host calls this before teardown so captured data is not silently abandoned.
   * The deadline aborts a delivery still in flight, so a hung target cannot hang the drain; an
   * adapter that already acted reports that as `DeliveryUncertain`, which is held, not retried.
   */
  async function drain(timeoutMs: number, pollMs = 200): Promise<number> {
    // A timeout is elapsed time; the injected clock may be frozen or skewed for backoff tests.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
    try {
      for (;;) {
        await runOnce(controller.signal, { ignoreBackoff: true });
        const remaining = (await pending()).filter(
          (effect) => effect.acknowledgedAt === undefined,
        ).length;
        if (remaining === 0 || controller.signal.aborted) return remaining;
        await abortableSleep(pollMs, controller.signal);
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  return { target: description.target, runOnce, drain, ...createLoop((signal) => runOnce(signal)) };
}
