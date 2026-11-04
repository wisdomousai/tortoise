import { errorEnvelope } from '@tortoise/contracts';
import type { Effect, EffectOutcome } from '@tortoise/runtime';
import type { DispatchReport, EffectDispatcherOptions } from '../dispatcher.js';
import {
  DeliveryFailure,
  DeliveryUncertain,
  type DeliveryResult,
  type TargetDescription,
  type DeliveryAcknowledged,
} from '../port.js';

/** How one effect left a pass: the report counter to raise, and whether the pass must stop. */
export interface Step {
  readonly countAs?: keyof DispatchReport;
  readonly stop?: boolean;
}

const conflicted = (error: unknown) => errorEnvelope(error).code === 'CONFLICT';

/** What every step needs: the dispatcher's options, the target's guarantees and this claim. */
interface Deps {
  readonly options: EffectDispatcherOptions;
  readonly description: TargetDescription;
  readonly claim: { readonly worker: string; readonly leaseMs: number };
}
type Attempt = Parameters<EffectDispatcherOptions['application']['recordAttempt']>[3] & {
  fence: number;
};

/** Record an attempt; a newer claim superseding this one means another worker took over. */
async function record(
  { options }: Deps,
  effect: Effect,
  failure: string,
  attempt: Attempt,
  countAs: keyof DispatchReport,
): Promise<Step> {
  try {
    await options.application.recordAttempt(options.context, effect.id, failure, attempt);
    return { countAs };
  } catch (error) {
    if (conflicted(error)) return { countAs: 'deferred' };
    throw error;
  }
}
const hold = (deps: Deps, effect: Effect, reason: string, fence: number) =>
  record(deps, effect, reason, { hold: true, fence }, 'held');

/** Claim before delivering; completed, held or claimed elsewhere since the read is deferred. */
async function claimed({ options, claim }: Deps, effect: Effect): Promise<number | Step> {
  try {
    const result = await options.application.claimEffect(options.context, effect.id, {
      ...claim,
      recheck: options.recheck !== false,
    });
    return result.status === 'claimed' ? result.fence : { countAs: 'held' };
  } catch (error) {
    if (conflicted(error)) return { countAs: 'deferred' };
    throw error;
  }
}

/** An acknowledged effect is never delivered again; its lookup tells how the target decided. */
async function poll(deps: Deps, effect: Effect, signal: AbortSignal, fence: number) {
  const { port } = deps.options;
  if (!port.lookup)
    return hold(deps, effect, 'The target acknowledged the effect but offers no lookup', fence);
  const found = await port.lookup(effect.id, signal, effect);
  if (found === undefined)
    return hold(deps, effect, 'The target no longer reports an effect it acknowledged', fence);
  if (found.status === 'uncertain') return hold(deps, effect, found.reason, fence);
  return found;
}

/** Look up an earlier delivery when needed, else deliver. A `Step` when there is no outcome. */
async function outcomeOf(
  deps: Deps,
  effect: Effect,
  signal: AbortSignal,
  fence: number,
): Promise<DeliveryResult | Step> {
  const { port } = deps.options;
  try {
    if (effect.acknowledgedAt !== undefined) return await poll(deps, effect, signal, fence);
    // A non-idempotent target may already hold a delivery whose response or completion was
    // lost, so it is always checked before sending again.
    if (!deps.description.idempotentDelivery) {
      const found = await port.lookup!(effect.id, signal, effect);
      // Neither confirmed nor ruled out: delivering again could act twice. A person (or an
      // agent through the reconciliation command) decides.
      if (found?.status === 'uncertain') return hold(deps, effect, found.reason, fence);
      if (found) return found;
    }
    return await port.deliver(effect, signal);
  } catch (error) {
    const uncertain = error instanceof DeliveryUncertain;
    // An uncertain outcome is recorded even during shutdown: the target may have changed, and
    // an unrecorded attempt looks fresh (`attempts === 0`) to the next process, which would
    // deliver again. Recording uses the dispatcher's own context, not the cancelled signal.
    if (signal.aborted && !uncertain) return { stop: true };
    const step = await record(
      deps,
      effect,
      error instanceof DeliveryFailure ? error.message : 'Delivery failed',
      { fence, ...(uncertain ? { hold: true } : {}) },
      uncertain ? 'held' : 'retried',
    );
    return { ...step, stop: signal.aborted };
  }
}

const acknowledged = (deps: Deps, effect: Effect, result: DeliveryAcknowledged, fence: number) =>
  record(
    deps,
    effect,
    'Awaiting the target decision',
    { fence, acknowledged: result.externalRef ? { externalRef: result.externalRef } : {} },
    'acknowledged',
  );

async function complete(
  { options }: Deps,
  effect: Effect,
  outcome: EffectOutcome,
  fence: number,
): Promise<Step> {
  const { application, context } = options;
  const input = options.completeInput
    ? options.completeInput(effect, outcome, { fence })
    : { effectId: effect.id, outcome };
  try {
    await application.invokeRaw(
      { operation: options.completeOperation, input, idempotencyKey: `complete:${effect.id}` },
      context,
    );
    return { countAs: outcome.status === 'accepted' ? 'accepted' : 'rejected' };
  } catch (error) {
    const { code } = errorEnvelope(error);
    // Another dispatcher completed it first, or a newer claim superseded this one; the target
    // deduplicates by effect ID, so the newer worker's delivery finds this one.
    if (code === 'CONFLICT') return {};
    await application
      .recordAttempt(context, effect.id, `Completion failed (${code})`, { fence })
      .catch(() => undefined);
    return { countAs: 'retried' };
  }
}

/**
 * The per-effect steps: claim the effect, obtain an outcome from the target, then complete it
 * through the domain. Every attempt and completion carries the claim's fencing token, so a
 * worker that paused past its lease finds its writes refused once another worker claimed.
 */
export function createDelivery(
  options: EffectDispatcherOptions,
  description: TargetDescription,
  claim: { readonly worker: string; readonly leaseMs: number },
) {
  const deps: Deps = { options, description, claim };
  return async (effect: Effect, signal: AbortSignal): Promise<Step> => {
    const fence = await claimed(deps, effect);
    if (typeof fence !== 'number') return fence;
    const result = await outcomeOf(deps, effect, signal, fence);
    if (!('status' in result)) return result;
    if (result.status === 'pending') return acknowledged(deps, effect, result, fence);
    return complete(deps, effect, result, fence);
  };
}
