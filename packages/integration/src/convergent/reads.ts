/** Clock and poll interval for repeated reads. Injected so tests run without real time. */
export interface ReadClock {
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly pollMs: number;
}

/** Sleep `ms`, or until `signal` aborts; never rejects. */
export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * A condition set evaluated against one view. `met` only when nothing is unmet and nothing is
 * unknown: a reading too unsure to judge is `unknown`, never met.
 */
export interface ConditionCheck {
  readonly met: boolean;
  readonly unmet: readonly string[];
  readonly unknown: readonly string[];
}

/**
 * Poll until the predicate holds on `required` consecutive views; on timeout or abort returns the
 * last view, unmatched.
 */
export async function waitFor<View>(
  clock: ReadClock,
  observe: (signal: AbortSignal) => Promise<View>,
  predicate: (view: View) => boolean,
  timeoutMs: number,
  signal: AbortSignal,
  required = 1,
): Promise<{ readonly view: View; readonly matched: boolean }> {
  const deadline = clock.now() + timeoutMs;
  let streak = 0;
  for (;;) {
    const view = await observe(signal);
    streak = predicate(view) ? streak + 1 : 0;
    if (streak >= required) return { view, matched: true };
    if (clock.now() >= deadline || signal.aborted) return { view, matched: false };
    await clock.sleep(clock.pollMs, signal);
  }
}

/**
 * Evaluate a condition set to the source's stability standard: met only when `required`
 * consecutive views all meet it, so one confident transient reading cannot establish a state.
 * Starts from `first` and stops at the first view that does not meet it, reporting that view.
 */
export async function confirm<View>(
  clock: ReadClock,
  observe: (signal: AbortSignal) => Promise<View>,
  check: (view: View) => ConditionCheck,
  required: number,
  first: View,
  signal: AbortSignal,
): Promise<ConditionCheck & { readonly view: View }> {
  let view = first;
  let result = check(view);
  for (let read = 1; result.met && read < required; read++) {
    await clock.sleep(clock.pollMs, signal);
    view = await observe(signal);
    result = check(view);
  }
  return { view, ...result };
}
