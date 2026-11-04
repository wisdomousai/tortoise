import type { Effect, EffectOutcome } from '@tortoise/runtime';
import { DeliveryFailure, interruption } from '@tortoise/integration';
import { evaluate, type View } from '../recognize';
import type { Frame, ScreenAction } from '../ports';
import { center, resolveBinding, type Procedure, type ProcedureStep } from '../profile';
import { accepted, observe, readsFor, showing, waitFor, type ControllerKernel } from './kernel';
import { blockedBy, forbiddenAt } from './safety';

/** One procedure in flight: what the gate checks before every action. */
interface Run {
  readonly kernel: ControllerKernel;
  readonly effect: Readonly<Effect>;
  readonly procedure: Procedure;
  readonly input: unknown;
  readonly signal: AbortSignal;
  readonly started: number;
  readonly since: number;
  acted: boolean;
  actions: number;
  /**
   * The screen the next action must find: the start screen, then whatever the last
   * `expect-screen` or `wait-for` step established. A popup or vendor dialog that appears after
   * an action is caught before the next one, never typed into.
   */
  expected: string;
  view: View;
}

const stop = (run: Run, message: string) =>
  interruption(run.acted, run.procedure.rerunnable ?? false, message);

/** Re-checked before every action: who has control, mode, local input, budget and deadline. */
async function guard(run: Run) {
  const { kernel, procedure, signal } = run;
  if (signal.aborted) throw stop(run, 'Delivery was cancelled');
  if (kernel.now() - run.started > procedure.timeoutMs)
    throw stop(run, `${procedure.title} timed out`);
  if (run.actions >= procedure.maxSteps)
    throw stop(run, `${procedure.title} exceeded its step budget`);
  const reason = blockedBy(await kernel.options.control(signal), procedure);
  if (reason) throw stop(run, reason);
  if (await kernel.options.transport.localInputSince?.(run.since, signal))
    throw stop(run, 'Someone used the station during the procedure');
}

/** Gate, verify the expected screen (on `frame` when given), then perform one action. */
async function act(run: Run, action: ScreenAction, at: string, frame?: Frame) {
  const { kernel, signal } = run;
  await guard(run);
  const shown = await kernel.recognizer.identify(
    frame ?? (await kernel.options.transport.capture(signal)),
    signal,
  );
  if (shown !== run.expected)
    throw stop(
      run,
      `Expected ${run.expected} before the ${action.kind} at ${at}, found ${shown ?? 'an unknown screen'}`,
    );
  run.acted = true;
  kernel.attempts.touch(run.effect.id);
  await kernel.options.transport.act(action, signal);
  run.actions++;
}

async function click(
  run: Run,
  target: Extract<ProcedureStep, { kind: 'click' }>['target'],
  at: string,
) {
  const { kernel, signal } = run;
  const frame = await kernel.options.transport.capture(signal);
  const point =
    'region' in target
      ? center(target.region)
      : await kernel.options.driver.resolveTarget(frame, target, signal);
  if (!point) throw stop(run, `Target not found at ${at}`);
  const zone = forbiddenAt(kernel.options.profile, frame, point);
  if (zone) throw stop(run, `Refused to act inside forbidden ${zone} at ${at}`);
  await act(run, { kind: 'click', point }, at, frame);
}

async function waitStep(run: Run, step: Extract<ProcedureStep, { kind: 'wait-for' }>, at: string) {
  const { kernel, procedure, input } = run;
  const { field, equals } = step;
  const fieldReady = (candidate: View) =>
    field === undefined ||
    (equals === undefined
      ? candidate.readings.has(field)
      : evaluate(kernel.recognizer, candidate, [{ field, equals }], input).met);
  const reached = await waitFor(
    kernel,
    (candidate) =>
      (step.screen === undefined || candidate.screen === step.screen) && fieldReady(candidate),
    Math.min(step.timeoutMs, Math.max(0, procedure.timeoutMs - (kernel.now() - run.started))),
    run.signal,
  );
  if (!reached.matched) throw stop(run, `Timed out waiting at ${at}; ${showing(reached.view)}`);
  run.view = reached.view;
  if (step.screen !== undefined) run.expected = step.screen;
}

async function runStep(run: Run, step: ProcedureStep, at: string) {
  switch (step.kind) {
    case 'expect-screen': {
      run.view = await observe(run.kernel, run.signal);
      if (run.view.screen !== step.screen)
        throw stop(
          run,
          `Expected ${step.screen} at ${at}, found ${run.view.screen ?? 'an unknown screen'}`,
        );
      run.expected = step.screen;
      break;
    }
    case 'click':
      await click(run, step.target, at);
      break;
    case 'type':
      await act(run, { kind: 'type', text: String(resolveBinding(step.text, run.input)) }, at);
      break;
    case 'key':
      await act(run, { kind: 'key', key: step.key }, at);
      break;
    case 'wait-for':
      await waitStep(run, step, at);
      break;
  }
}

/** Accept only on readback stable across the fields' `stableReads`, within what time is left. */
async function readback(run: Run): Promise<EffectOutcome> {
  const { kernel, procedure, input } = run;
  const confirmed = await waitFor(
    kernel,
    (candidate) => evaluate(kernel.recognizer, candidate, procedure.readback, input).met,
    Math.max(kernel.pollMs, procedure.timeoutMs - (kernel.now() - run.started)),
    run.signal,
    readsFor(kernel, procedure.readback),
  );
  if (!confirmed.matched)
    throw stop(
      run,
      `${procedure.title} ran but the station does not show the result; ${showing(confirmed.view)}`,
    );
  return accepted(confirmed.view);
}

/**
 * Run a gated procedure's steps from `view` (its start screen, preconditions met) and confirm the
 * result. Once anything was done, an interruption is `DeliveryUncertain` unless the procedure is
 * declared `rerunnable`.
 */
export async function runProcedure(
  kernel: ControllerKernel,
  effect: Readonly<Effect>,
  procedure: Procedure,
  view: View,
  signal: AbortSignal,
): Promise<EffectOutcome> {
  const run: Run = {
    kernel,
    effect,
    procedure,
    input: effect.payload,
    signal,
    started: kernel.now(),
    since: view.frame.capturedAt,
    acted: false,
    actions: 0,
    expected: procedure.startScreen,
    view,
  };
  try {
    for (const [index, step] of procedure.steps.entries())
      await runStep(run, step, `step ${index + 1} of ${procedure.steps.length}`);
    return await readback(run);
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;
    // Transport or recognition broke mid-procedure. Its text may carry host details, so it is
    // replaced; whether the station changed is unknown once anything was done.
    throw stop(run, `${procedure.title} failed: the screen or its recognizer became unavailable`);
  }
}
