import type { EffectOutcome } from '@agent-native/runtime';
import type { StationConnectorOptions } from '../controller';
import { createPerception, evaluate, type Perception, type View } from '../perceive';
import type { Condition, Procedure } from '../profile';

/** What every delivery and lookup shares: perception, clock and this process's attempt memory. */
export interface ControllerKernel {
  readonly options: StationConnectorOptions;
  readonly perception: Perception;
  readonly procedures: ReadonlyMap<string, Procedure>;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly pollMs: number;
  /**
   * Effects this process attempted, and the subset where it touched the screen. A failed attempt
   * that never acted is safe to redeliver; after a restart the memory is gone and lookup falls
   * back to the conservative screen rule.
   */
  readonly attempted: Set<string>;
  readonly touched: Set<string>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

export function createControllerKernel(options: StationConnectorOptions): ControllerKernel {
  return {
    options,
    perception: createPerception(options.profile, options.extractors),
    procedures: new Map(options.profile.procedures.map((procedure) => [procedure.id, procedure])),
    now: options.now ?? Date.now,
    sleep: options.sleep ?? defaultSleep,
    pollMs: options.pollMs ?? 250,
    attempted: new Set(),
    touched: new Set(),
  };
}

export const rejected = (code: string, message: string): EffectOutcome => ({
  status: 'rejected',
  code,
  message: message.slice(0, 500),
});

export const accepted = (view: View): EffectOutcome => ({
  status: 'accepted',
  externalRef: `readback:${view.frame.digest.slice(0, 16)}`,
});

export const showing = (view: View) => `the station shows ${view.screen ?? 'an unknown screen'}`;

export const observe = async (kernel: ControllerKernel, signal: AbortSignal): Promise<View> =>
  kernel.perception.view(await kernel.options.transport.capture(signal), signal);

/**
 * Poll until the predicate holds on `required` consecutive views; on timeout returns the last
 * view, unmatched.
 */
export async function waitFor(
  kernel: ControllerKernel,
  predicate: (view: View) => boolean,
  timeoutMs: number,
  signal: AbortSignal,
  required = 1,
): Promise<{ readonly view: View; readonly matched: boolean }> {
  const deadline = kernel.now() + timeoutMs;
  let streak = 0;
  for (;;) {
    const view = await observe(kernel, signal);
    streak = predicate(view) ? streak + 1 : 0;
    if (streak >= required) return { view, matched: true };
    if (kernel.now() >= deadline || signal.aborted) return { view, matched: false };
    await kernel.sleep(kernel.pollMs, signal);
  }
}

/** Consecutive agreeing views a condition set needs: the most `stableReads` among its fields. */
export const readsFor = (kernel: ControllerKernel, conditions: readonly Condition[]) =>
  Math.max(1, ...conditions.map((item) => kernel.perception.field(item.field)?.stableReads ?? 1));

/**
 * Evaluate conditions to the profile's standard, the same one the observer applies: met only
 * when `readsFor` consecutive views all meet them, so one confident transient reading cannot
 * establish a state. Stops at the first view that does not, and reports that view's result.
 */
export async function confirm(
  kernel: ControllerKernel,
  conditions: readonly Condition[],
  input: unknown,
  first: View,
  signal: AbortSignal,
) {
  let view = first;
  let result = evaluate(kernel.perception, view, conditions, input);
  for (let read = 1; result.met && read < readsFor(kernel, conditions); read++) {
    await kernel.sleep(kernel.pollMs, signal);
    view = await observe(kernel, signal);
    result = evaluate(kernel.perception, view, conditions, input);
  }
  return { view, ...result };
}
