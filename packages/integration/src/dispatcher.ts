import { errorEnvelope } from '@agent-native/contracts';
import type {
  CommandReceipt,
  Effect,
  EffectOutcome,
  ExecutionContext,
  Invocation,
} from '@agent-native/runtime';
import { abortableSleep, createLoop } from './loop.js';
import {
  DeliveryFailure,
  DeliveryUncertain,
  type SystemOfRecordPort,
  type TargetDescription,
} from './port.js';

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
    attempt?: { readonly hold?: boolean },
  ): Promise<Effect>;
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
}
export interface DispatchReport {
  accepted: number;
  rejected: number;
  retried: number;
  deferred: number;
  /** Effects whose outcome at the target is unknown; they wait for a reconciliation command. */
  held: number;
}
export interface EffectDispatcherOptions {
  readonly application: DispatcherApplication;
  readonly port: SystemOfRecordPort;
  /**
   * Trusted integration identity supplied by the host. Give it a grant limited to the settlement
   * operation so a compromised port cannot drive other business commands.
   */
  readonly context: ExecutionContext;
  /** Domain command that records an outcome through `ctx.settleEffect` and updates domain state. */
  readonly settleOperation: string;
  readonly settleInput?: (effect: Readonly<Effect>, outcome: EffectOutcome) => unknown;
  /** Delay before retry after `attempts` failures. Defaults to exponential backoff capped at 60 s. */
  readonly backoff?: (attempts: number) => number;
  readonly batchSize?: number;
  /** Must match the application's clock, which stamps `lastAttemptAt`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** How one effect left a pass: the report counter to raise, and whether the pass must stop. */
interface Step {
  readonly tally?: keyof DispatchReport;
  readonly stop?: boolean;
}

/** The per-effect steps: obtain an outcome from the target, then settle it through the domain. */
function createDelivery(options: EffectDispatcherOptions, description: TargetDescription) {
  const { application, context, port } = options;
  const settleInput =
    options.settleInput ??
    ((effect: Readonly<Effect>, outcome: EffectOutcome) => ({ effectId: effect.id, outcome }));

  /** Look up an earlier delivery when needed, else deliver. A `Step` when there is no outcome. */
  async function outcomeOf(effect: Effect, signal: AbortSignal): Promise<EffectOutcome | Step> {
    try {
      // A non-idempotent target may already hold a delivery whose response or settlement was
      // lost, so it is always checked before sending again.
      if (!description.idempotentDelivery) {
        const found = await port.lookup!(effect.id, signal, effect);
        if (found?.status === 'uncertain') {
          // Neither confirmed nor ruled out: delivering again could act twice. A person (or an
          // agent through the reconciliation command) decides.
          await application.recordAttempt(context, effect.id, found.reason, { hold: true });
          return { tally: 'held' };
        }
        if (found) return found;
      }
      return await port.deliver(effect, signal);
    } catch (error) {
      const uncertain = error instanceof DeliveryUncertain;
      // An uncertain outcome is recorded even during shutdown: the target may have changed, and
      // an unrecorded attempt looks fresh (`attempts === 0`) to the next process, which would
      // deliver again. Recording uses the dispatcher's own context, not the cancelled signal.
      if (signal.aborted && !uncertain) return { stop: true };
      await application.recordAttempt(
        context,
        effect.id,
        error instanceof DeliveryFailure ? error.message : 'Delivery failed',
        uncertain ? { hold: true } : {},
      );
      return { tally: uncertain ? 'held' : 'retried', stop: signal.aborted };
    }
  }

  async function settle(effect: Effect, outcome: EffectOutcome): Promise<Step> {
    try {
      await application.invokeRaw(
        {
          operation: options.settleOperation,
          input: settleInput(effect, outcome),
          idempotencyKey: `settle:${effect.id}`,
        },
        context,
      );
      return { tally: outcome.status === 'accepted' ? 'accepted' : 'rejected' };
    } catch (error) {
      const { code } = errorEnvelope(error);
      // Another dispatcher settled it first; the target already holds a single record.
      if (code === 'CONFLICT') return {};
      await application
        .recordAttempt(context, effect.id, `Settlement failed (${code})`)
        .catch(() => undefined);
      return { tally: 'retried' };
    }
  }

  return async (effect: Effect, signal: AbortSignal): Promise<Step> => {
    const result = await outcomeOf(effect, signal);
    return 'status' in result ? settle(effect, result) : result;
  };
}

/**
 * Delivers committed outbox effects to one target outside every transaction, then records each
 * outcome through the domain's settlement command. Delivery is at least once: duplicates are
 * prevented by the target deduplicating on the effect ID, or, for targets that cannot, by looking
 * up an earlier delivery before every send. A settlement replay uses `settle:<effectId>` as its
 * idempotency key, so a lost settlement response is safe to repeat.
 */
export function createEffectDispatcher(options: EffectDispatcherOptions) {
  const description = options.port.describe();
  if (!description.idempotentDelivery && !options.port.lookup)
    throw new Error(`Target ${description.target} needs lookup because delivery is not idempotent`);
  const now = options.now ?? Date.now;
  const backoff =
    options.backoff ?? ((attempts: number) => Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
  const dispatch = createDelivery(options, description);
  const pending = (limit?: number) =>
    options.application.pendingEffects(options.context, {
      target: description.target,
      ...(limit === undefined ? {} : { limit }),
    });

  async function runOnce(
    signal: AbortSignal = new AbortController().signal,
    { ignoreBackoff = false } = {},
  ): Promise<DispatchReport> {
    const report: DispatchReport = { accepted: 0, rejected: 0, retried: 0, deferred: 0, held: 0 };
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
      if (step.tally) report[step.tally]++;
      if (step.stop) break;
    }
    return report;
  }

  /**
   * Deliver until nothing is pending or the timeout passes, ignoring backoff. Returns the number of
   * effects still awaiting delivery; held effects await reconciliation and are not counted. An
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
        const remaining = (await pending()).length;
        if (remaining === 0 || controller.signal.aborted) return remaining;
        await abortableSleep(pollMs, controller.signal);
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  return { target: description.target, runOnce, drain, ...createLoop((signal) => runOnce(signal)) };
}
