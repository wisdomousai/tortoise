import { ApplicationError, assertJson } from '@agent-native/contracts';
import type { Effect, EffectOutcome, EffectRequest, WorkspaceSnapshot } from '../types.js';
import { byCodePoint, defineOwn } from './records.js';

/** Outbox records and their state transitions. Every function here runs inside a transaction. */

export const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const ownEffect = <State>(
  snapshot: WorkspaceSnapshot<State>,
  id: string,
): Effect | undefined => (Object.hasOwn(snapshot.effects, id) ? snapshot.effects[id] : undefined);

export const putEffect = <State>(snapshot: WorkspaceSnapshot<State>, effect: Effect): void =>
  defineOwn(snapshot.effects, effect.id, effect);

/** Oldest first; identifiers break ties so every adapter returns the same order. */
export const byCreation = (a: Effect, b: Effect) =>
  a.createdAt - b.createdAt || byCodePoint(a.id, b.id);

/** A pending effect, or NOT_FOUND / CONFLICT. */
export function pendingEffect<State>(snapshot: WorkspaceSnapshot<State>, id: string): Effect {
  const effect = ownEffect(snapshot, id);
  if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
  if (effect.status !== 'pending') throw new ApplicationError('CONFLICT', 'Effect already settled');
  return effect;
}

function validOutcome(outcome: EffectOutcome): EffectOutcome {
  if (
    outcome?.status === 'accepted' &&
    (outcome.externalRef === undefined || boundedText(outcome.externalRef, 256))
  )
    return outcome.externalRef === undefined
      ? { status: 'accepted' }
      : { status: 'accepted', externalRef: outcome.externalRef };
  if (
    outcome?.status === 'rejected' &&
    boundedText(outcome.code, 128) &&
    boundedText(outcome.message, 2000)
  )
    return { status: 'rejected', code: outcome.code, message: outcome.message };
  throw new ApplicationError('INVALID_INPUT', 'Invalid effect outcome');
}

/** Validate a handler's request; the payload is copied so later handler writes cannot alias it. */
export function assertEffectRequest(request: EffectRequest): void {
  if (
    !boundedText(request?.target, 128) ||
    !boundedText(request.type, 128) ||
    !boundedText(request.resource, 512)
  )
    throw new ApplicationError('INTERNAL', 'Effect requires target, type and resource');
  try {
    assertJson(request.payload);
  } catch {
    throw new ApplicationError('INTERNAL', 'Effect payload must be JSON');
  }
}

export function enqueuedEffect(
  request: EffectRequest,
  meta: { id: string; operation: string; principalId: string; createdAt: number },
): Effect {
  return {
    id: meta.id,
    target: request.target,
    type: request.type,
    resource: request.resource,
    payload: structuredClone(request.payload),
    operation: meta.operation,
    principalId: meta.principalId,
    createdAt: meta.createdAt,
    status: 'pending',
    attempts: 0,
  };
}

export function settledEffect(effect: Effect, outcome: EffectOutcome, now: () => number): Effect {
  // Held is a sub-state of pending: a settled effect no longer awaits reconciliation.
  const { heldAt: _heldAt, holdReason: _holdReason, ...unheld } = effect;
  const valid = validOutcome(outcome);
  return { ...unheld, status: valid.status, outcome: valid, settledAt: now() };
}

export function releasedEffect(effect: Effect): Effect {
  if (effect.status !== 'pending' || effect.heldAt === undefined)
    throw new ApplicationError('CONFLICT', 'Effect is not held');
  // Clearing the attempt clock lets the dispatcher deliver on its next pass, without backoff.
  const { heldAt: _heldAt, holdReason: _holdReason, lastAttemptAt: _last, ...rest } = effect;
  return rest;
}

export function attemptedEffect(
  effect: Effect,
  failure: string,
  hold: boolean | undefined,
  now: () => number,
): Effect {
  return {
    ...effect,
    attempts: effect.attempts + 1,
    lastAttemptAt: now(),
    lastFailure: (failure || 'Delivery failed').slice(0, 500),
    ...(hold ? { heldAt: now(), holdReason: (failure || 'Outcome unknown').slice(0, 500) } : {}),
  };
}
