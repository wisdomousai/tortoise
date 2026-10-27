import type { EffectOutcome } from '@agent-native/runtime';
import {
  abortableSleep,
  AttemptMemory,
  confirm as confirmReads,
  waitFor as waitForReads,
  type ReadClock,
} from '@agent-native/integration';
import type { StationConnectorOptions } from '../controller';
import { createRecognizer, evaluate, type Recognizer, type View } from '../recognize';
import type { Condition, Procedure } from '../profile';

/** What every delivery and lookup shares: the recognizer, clock and this process's attempt memory. */
export interface ControllerKernel extends ReadClock {
  readonly options: StationConnectorOptions;
  readonly recognizer: Recognizer;
  readonly procedures: ReadonlyMap<string, Procedure>;
  /** Effects this process attempted, and whether it touched the screen for them. */
  readonly attempts: AttemptMemory;
}

export function createControllerKernel(options: StationConnectorOptions): ControllerKernel {
  return {
    options,
    recognizer: createRecognizer(options.profile, options.extractors),
    procedures: new Map(options.profile.procedures.map((procedure) => [procedure.id, procedure])),
    now: options.now ?? Date.now,
    sleep: options.sleep ?? abortableSleep,
    pollMs: options.pollMs ?? 250,
    attempts: new AttemptMemory(),
  };
}

export { rejected } from '@agent-native/integration';

export const accepted = (view: View): EffectOutcome => ({
  status: 'accepted',
  externalRef: `readback:${view.frame.digest.slice(0, 16)}`,
});

export const showing = (view: View) => `the station shows ${view.screen ?? 'an unknown screen'}`;

export const observe = async (kernel: ControllerKernel, signal: AbortSignal): Promise<View> =>
  kernel.recognizer.view(await kernel.options.transport.capture(signal), signal);

/** Poll until the predicate holds on `required` consecutive views (see the integration `waitFor`). */
export const waitFor = (
  kernel: ControllerKernel,
  predicate: (view: View) => boolean,
  timeoutMs: number,
  signal: AbortSignal,
  required = 1,
) =>
  waitForReads(kernel, (inner) => observe(kernel, inner), predicate, timeoutMs, signal, required);

/** Consecutive agreeing views a condition set needs: the most `stableReads` among its fields. */
export const readsFor = (kernel: ControllerKernel, conditions: readonly Condition[]) =>
  Math.max(1, ...conditions.map((item) => kernel.recognizer.field(item.field)?.stableReads ?? 1));

/**
 * Evaluate conditions to the profile's standard, the same one the observer applies: met only
 * when `readsFor` consecutive views all meet them (see the integration `confirm`).
 */
export const confirm = (
  kernel: ControllerKernel,
  conditions: readonly Condition[],
  input: unknown,
  first: View,
  signal: AbortSignal,
) =>
  confirmReads(
    kernel,
    (inner) => observe(kernel, inner),
    (view) => evaluate(kernel.recognizer, view, conditions, input),
    readsFor(kernel, conditions),
    first,
    signal,
  );
