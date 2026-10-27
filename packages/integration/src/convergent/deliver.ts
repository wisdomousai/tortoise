import type { Effect, EffectOutcome } from '@agent-native/runtime';
import { DeliveryFailure, DeliveryUncertain, type LookupResult } from '../port.js';
import type { ConditionCheck } from './reads.js';

/** A business rejection with a message capped for application state. */
export const rejected = (code: string, message: string): EffectOutcome => ({
  status: 'rejected',
  code,
  message: message.slice(0, 500),
});

/**
 * The failure for an interrupted action. Once anything was done, the target's state is unknown,
 * so the effect is held for a person (`DeliveryUncertain`) unless the action is declared
 * rerunnable; before that, it is an ordinary transient failure and is retried.
 */
export const interruption = (acted: boolean, rerunnable: boolean, message: string) =>
  acted && !rerunnable ? new DeliveryUncertain(message) : new DeliveryFailure(message);

/**
 * One convergent delivery: what a connector supplies for a target it can only observe and act
 * on, such as a screen or an instrument. `converged` and `preconditions` confirm their
 * conditions across stable reads (see `confirm`), starting from the view they are given.
 */
export interface ConvergentDelivery<View> {
  readonly title: string;
  observe(signal: AbortSignal): Promise<View>;
  /** Whether the target already shows the effect's desired state. */
  converged(first: View, signal: AbortSignal): Promise<ConditionCheck & { readonly view: View }>;
  accepted(view: View): EffectOutcome;
  /** Why acting cannot start from this view (a wrong screen or mode); retried later. */
  notReady?(view: View): string | undefined;
  preconditions(
    first: View,
    signal: AbortSignal,
  ): Promise<ConditionCheck & { readonly view: View }>;
  /** Act and read the result back; throws `interruption(...)` when stopped part way. */
  act(view: View, signal: AbortSignal): Promise<EffectOutcome>;
}

/**
 * Deliver by convergence, in this order:
 * 1. Observe. If the target already shows the desired state across stable reads, accept without
 *    acting, so redelivery is idempotent.
 * 2. If acting cannot start from what the target shows, fail transiently; nothing was done.
 * 3. Confirm preconditions. Unreadable ones fail transiently; unmet ones reject as business data.
 * 4. Act, then accept only on a readback the connector confirms.
 * Gating (mode, control holder, payload checks) happens before this, in the connector.
 */
export async function deliverConvergent<View>(
  delivery: ConvergentDelivery<View>,
  signal: AbortSignal,
): Promise<EffectOutcome> {
  const converged = await delivery.converged(await delivery.observe(signal), signal);
  if (converged.met) return delivery.accepted(converged.view);
  const notReady = delivery.notReady?.(converged.view);
  if (notReady) throw new DeliveryFailure(notReady);
  const preconditions = await delivery.preconditions(converged.view, signal);
  if (preconditions.unknown.length)
    throw new DeliveryFailure(`Cannot read ${preconditions.unknown.join(', ')} with confidence`);
  if (preconditions.unmet.length)
    return rejected(
      'PRECONDITION',
      `${delivery.title} not possible: ${preconditions.unmet.join('; ')}`,
    );
  return delivery.act(preconditions.view, signal);
}

/** What `lookupConvergent` needs to judge an earlier delivery of `effect`. */
export interface ConvergentLookup<View> {
  readonly effect: Readonly<Effect>;
  readonly rerunnable: boolean;
  /** This process attempted the effect and never acted on the target. */
  readonly untouched: boolean;
  readback(signal: AbortSignal): Promise<ConditionCheck & { readonly view: View }>;
  accepted(view: View): EffectOutcome;
  /** The target is back where the action starts, so an earlier attempt did not stick. */
  atStart(view: View): boolean;
  uncertain(view: View): string;
}

/**
 * Readback of an earlier delivery. Converged: accepted. Never attempted, released by a person
 * since its last attempt (`releasedAt`), attempted by this process without acting, rerunnable, or
 * back at the start: deliver again. Anything else is uncertain, so the dispatcher holds it for a
 * person.
 */
export async function lookupConvergent<View>(
  lookup: ConvergentLookup<View>,
  signal: AbortSignal,
): Promise<LookupResult> {
  const readback = await lookup.readback(signal);
  if (readback.met) return lookup.accepted(readback.view);
  const view = readback.view;
  if (
    lookup.effect.attempts === 0 ||
    lookup.effect.releasedAt !== undefined ||
    lookup.untouched ||
    lookup.atStart(view) ||
    lookup.rerunnable
  )
    return undefined;
  return { status: 'uncertain', reason: lookup.uncertain(view) };
}

/**
 * Effects this process attempted, and the subset where it acted on the target. A failed attempt
 * that never acted is safe to redeliver; after a restart the memory is gone and lookup falls back
 * to what the target shows.
 */
export class AttemptMemory {
  private readonly attempted = new Set<string>();
  private readonly touched = new Set<string>();
  attempt(effectId: string) {
    this.attempted.add(effectId);
  }
  touch(effectId: string) {
    this.touched.add(effectId);
  }
  untouched(effectId: string) {
    return this.attempted.has(effectId) && !this.touched.has(effectId);
  }
}
