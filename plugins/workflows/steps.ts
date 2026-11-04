import type { JsonValue, RetryPolicy, RunStep, WaitStep } from '@tortoise/contracts';
import type { Effect } from '@tortoise/runtime';
import { holds, keep, resolve, type Scope } from './bindings';
import type { Definition } from './definitions';
import type { Context, Instance } from './state';

/** Codes retried without a policy naming them: the target or the draft may succeed next time. */
export const TRANSIENT = ['UNAVAILABLE', 'CONFLICT'];
/** The policy of a step without one, and of every compensation. */
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, backoffMs: 1_000 };
const MAX_BACKOFF_MS = 3_600_000;

const scope = (instance: Instance, result?: unknown): Scope => ({
  input: instance.input,
  values: instance.values,
  ...(result === undefined ? {} : { result }),
});

function record(
  instance: Instance,
  step: string,
  outcome: Instance['history'][number]['outcome'],
  at: number,
  failure?: { code: string; message: string },
) {
  instance.history.push({ step, outcome, at, ...(failure ?? {}) });
}

function finish(instance: Instance, status: Instance['status'], at: number) {
  instance.status = status;
  instance.finishedAt = at;
  delete instance.pending;
  delete instance.wait;
}

/** Move past a step: queue its compensation, then run the next step or succeed. */
function complete(
  instance: Instance,
  definition: Definition,
  step: RunStep | WaitStep,
  at: number,
) {
  if (step.kind === 'run' && step.compensate)
    instance.compensations.push({
      step: step.id,
      command: step.compensate.command,
      input: resolve(step.compensate.input, scope(instance)) as JsonValue,
    });
  record(instance, step.id, 'completed', at);
  instance.index++;
  instance.attempts = 0;
  delete instance.pending;
  delete instance.wait;
  delete instance.held;
  if (instance.index >= definition.workflow.steps.length) return finish(instance, 'succeeded', at);
  instance.status = 'running';
  instance.nextAt = at;
}

/**
 * A failed step or compensation. A transient code, or one the step's policy lists, is tried
 * again after a backoff until the attempts run out. Otherwise a failed step starts undoing the
 * completed steps (or fails the instance when none has a compensation), and a failed
 * compensation stalls the instance for a person.
 */
export function failStep(
  instance: Instance,
  definition: Definition | undefined,
  failure: { code: string; message: string },
  at: number,
) {
  const compensating = instance.status === 'compensating';
  const step = definition?.workflow.steps[instance.index];
  const name = compensating ? instance.compensations.at(-1)!.step : (step?.id ?? 'unknown');
  const policy = (!compensating && step?.kind === 'run' && step.retry) || DEFAULT_RETRY;
  const retried = [...TRANSIENT, ...(policy.on ?? [])].includes(failure.code);
  if (retried && instance.attempts + 1 < policy.attempts) {
    instance.attempts++;
    const backoff = (policy.backoffMs ?? 0) * 2 ** (instance.attempts - 1);
    instance.nextAt = at + Math.min(backoff, MAX_BACKOFF_MS);
    // A retried step runs its command again; the effects it awaited belong to the failed try.
    delete instance.pending;
    record(instance, name, 'retried', at, failure);
    return;
  }
  record(instance, name, failure.code === 'TIMEOUT' ? 'timed-out' : 'failed', at, failure);
  instance.error = { step: name, ...failure };
  instance.attempts = 0;
  delete instance.pending;
  delete instance.held;
  if (compensating) {
    instance.status = 'stalled';
    instance.stalledReason = 'COMPENSATION_FAILED';
  } else if (instance.compensations.length) {
    instance.status = 'compensating';
    instance.nextAt = at;
    delete instance.wait;
  } else finish(instance, 'failed', at);
}

/** Undo the latest completed step; once none is left, the instance is compensated or cancelled. */
async function compensate(instance: Instance, ctx: Context, at: number) {
  const next = instance.compensations.at(-1);
  if (next) {
    await ctx.invokeRaw(next.command, next.input);
    instance.compensations.pop();
    instance.attempts = 0;
    record(instance, next.step, 'compensated', at);
  }
  if (instance.compensations.length) instance.nextAt = at;
  else finish(instance, instance.cancelledBy === undefined ? 'compensated' : 'cancelled', at);
}

const completed = (effect: Effect | undefined) => !!effect && effect.status !== 'pending';
const effectValue = (effect: Effect) => ({
  status: effect.status,
  ...(effect.outcome?.status === 'accepted' && effect.outcome.externalRef
    ? { externalRef: effect.outcome.externalRef }
    : {}),
});

/** The effects a step awaits, in the order it enqueued them. */
export const awaited = (instance: Instance, ctx: Pick<Context, 'effects'>) => {
  const ids = instance.pending?.effects ?? [];
  const byId = new Map(
    ctx
      .effects()
      .filter((effect) => ids.includes(effect.id))
      .map((effect) => [effect.id, effect]),
  );
  return ids.map((id) => byId.get(id));
};
export const allCompleted = (effects: readonly (Effect | undefined)[]) => effects.every(completed);

/** A step awaiting its effects: complete it once every one was accepted, fail it on a refusal. */
function resolveAwaited(
  instance: Instance,
  definition: Definition,
  step: RunStep,
  ctx: Context,
  at: number,
) {
  const effects = awaited(instance, ctx);
  if (!allCompleted(effects)) {
    instance.held = effects.some((effect) => effect?.heldAt !== undefined);
    return;
  }
  const refused = effects.find((effect) => effect!.status !== 'accepted');
  if (refused) {
    const outcome = refused.outcome;
    return failStep(
      instance,
      definition,
      outcome?.status === 'rejected'
        ? { code: outcome.code, message: outcome.message }
        : { code: 'EFFECT_CANCELLED', message: refused.cancelReason ?? 'The effect was cancelled' },
      at,
    );
  }
  Object.assign(
    instance.values[step.id]!,
    keep(
      definition.paths.get(step.id),
      undefined,
      effects.map((effect) => effectValue(effect!)),
    ),
  );
  complete(instance, definition, step, at);
}

async function run(
  instance: Instance,
  definition: Definition,
  step: RunStep,
  ctx: Context,
  at: number,
) {
  if (step.when && !holds(step.when, scope(instance))) {
    instance.values[step.id] = {};
    record(instance, step.id, 'skipped', at);
    instance.index++;
    instance.attempts = 0;
    if (instance.index >= definition.workflow.steps.length)
      return finish(instance, 'succeeded', at);
    instance.nextAt = at;
    return;
  }
  const { result, effects } = await ctx.invokeRaw(
    step.command,
    resolve(step.input, scope(instance)),
  );
  instance.values[step.id] = keep(definition.paths.get(step.id), result);
  if (step.await === 'effects' && effects.length) {
    instance.pending = { effects: [...effects] };
    instance.nextAt = at;
    return;
  }
  complete(instance, definition, step, at);
}

async function wait(
  instance: Instance,
  definition: Definition,
  step: WaitStep,
  ctx: Context,
  at: number,
  cursor: number | undefined,
) {
  instance.wait ??= { since: at };
  if (cursor !== undefined) instance.wait.cursor = cursor;
  const result = await ctx.queryRaw(step.query, resolve(step.input, scope(instance)));
  if (holds(step.until, scope(instance, result))) {
    instance.values[step.id] = keep(definition.paths.get(step.id), result);
    return complete(instance, definition, step, at);
  }
  const timeoutAt = instance.wait.since + step.timeoutMs;
  if (at >= timeoutAt)
    return failStep(
      instance,
      definition,
      { code: 'TIMEOUT', message: `Step ${step.id} waited ${step.timeoutMs / 1000} s` },
      at,
    );
  instance.status = 'waiting';
  instance.nextAt = Math.min(timeoutAt, step.recheckMs ? at + step.recheckMs : timeoutAt);
}

/**
 * One advance: the next compensation, the awaited effects of the current step, or the current
 * step. A step's command or query runs as a nested call, so it commits with this record or not
 * at all; when it fails, the runner records the failure with `workflow.fail`.
 */
export async function advance(
  instance: Instance,
  definition: Definition | undefined,
  ctx: Context,
  at: number,
  cursor?: number,
) {
  if (instance.status === 'compensating') return compensate(instance, ctx, at);
  if (!definition || definition.fingerprint !== instance.fingerprint) {
    instance.status = 'stalled';
    instance.stalledReason = 'DEFINITION_CHANGED';
    return;
  }
  if (at >= instance.deadline)
    return failStep(
      instance,
      definition,
      { code: 'DEADLINE', message: 'The workflow ran past its maximum duration' },
      at,
    );
  const step = definition.workflow.steps[instance.index]!;
  if (step.kind === 'wait') return wait(instance, definition, step, ctx, at, cursor);
  if (instance.pending) return resolveAwaited(instance, definition, step, ctx, at);
  return run(instance, definition, step, ctx, at);
}
