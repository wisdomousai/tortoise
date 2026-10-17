import { ApplicationError, assertJson, type JsonValue } from '@agent-native/contracts';
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

/**
 * The effect as callers outside the kernel see it: without the originating command's input,
 * which only the dispatch-time recheck reads, so a port or screen never receives more than the
 * payload the command chose to send.
 */
export function publicEffect(effect: Effect): Effect {
  const { input: _input, ...rest } = effect;
  return structuredClone(rest);
}

/**
 * Refuse an attempt or settlement whose fencing token is older than the effect's current claim:
 * a newer worker owns the delivery now. No token (a person's reconciliation) is not fenced.
 */
export function checkFence(effect: Effect, fence: number | undefined): void {
  if (fence !== undefined && effect.claim !== undefined && effect.claim.fence !== fence)
    throw new ApplicationError('CONFLICT', 'A newer delivery attempt claimed this effect');
}

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
  meta: {
    id: string;
    operation: string;
    principalId: string;
    createdAt: number;
    contractVersion?: string;
    input?: JsonValue;
  },
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
    ...(meta.contractVersion === undefined ? {} : { contractVersion: meta.contractVersion }),
    status: 'pending',
    attempts: 0,
    ...(meta.input === undefined ? {} : { input: structuredClone(meta.input) }),
  };
}

export function settledEffect(
  effect: Effect,
  outcome: EffectOutcome,
  now: () => number,
  fence?: number,
): Effect {
  checkFence(effect, fence);
  // Held is a sub-state of pending: a settled effect no longer awaits reconciliation.
  const { heldAt: _heldAt, holdReason: _holdReason, claim: _claim, ...unheld } = effect;
  const valid = validOutcome(outcome);
  return { ...unheld, status: valid.status, outcome: valid, settledAt: now() };
}

export function releasedEffect(effect: Effect): Effect {
  if (effect.status !== 'pending' || effect.heldAt === undefined)
    throw new ApplicationError('CONFLICT', 'Effect is not held');
  // Clearing the attempt clock lets the dispatcher deliver on its next pass, without backoff. A
  // released effect the target had acknowledged is delivered again, so the acknowledgement goes.
  const {
    heldAt: _heldAt,
    holdReason: _holdReason,
    lastAttemptAt: _last,
    claim: _claim,
    upstreamAt: _upstreamAt,
    upstreamRef: _upstreamRef,
    ...rest
  } = effect;
  return rest;
}

/** Withdraw an effect no worker ever claimed; it was never sent, so nothing can be lost. */
export function cancelledEffect(effect: Effect, reason: string, now: () => number): Effect {
  if (effect.status !== 'pending') throw new ApplicationError('CONFLICT', 'Effect already settled');
  if (effect.fence !== undefined || effect.attempts > 0)
    throw new ApplicationError('CONFLICT', 'Effect was already claimed for delivery');
  if (!boundedText(reason, 500))
    throw new ApplicationError('INVALID_INPUT', 'Cancellation requires a reason');
  return { ...effect, status: 'cancelled', cancelReason: reason, settledAt: now() };
}

/** Claim a deliverable effect for one worker; a live claim by another worker conflicts. */
export function claimedEffect(
  effect: Effect,
  worker: string,
  leaseMs: number,
  now: () => number,
): Effect {
  if (effect.heldAt !== undefined) throw new ApplicationError('CONFLICT', 'Effect is held');
  if (effect.claim && effect.claim.expiresAt > now() && effect.claim.worker !== worker)
    throw new ApplicationError('CONFLICT', 'Another worker is delivering this effect');
  const fence = (effect.fence ?? 0) + 1;
  return { ...effect, fence, claim: { worker, fence, expiresAt: now() + leaseMs } };
}

/** The target acknowledged the effect but has not decided; poll its lookup from now on. */
export function upstreamEffect(
  effect: Effect,
  externalRef: string | undefined,
  now: () => number,
  fence?: number,
): Effect {
  checkFence(effect, fence);
  const { claim: _claim, ...rest } = effect;
  return {
    ...rest,
    attempts: effect.attempts + 1,
    lastAttemptAt: now(),
    upstreamAt: effect.upstreamAt ?? now(),
    ...(externalRef ? { upstreamRef: externalRef.slice(0, 256) } : {}),
  };
}

export function attemptedEffect(
  effect: Effect,
  failure: string,
  hold: boolean | undefined,
  now: () => number,
  fence?: number,
): Effect {
  checkFence(effect, fence);
  const { claim: _claim, ...rest } = effect;
  return {
    ...rest,
    attempts: effect.attempts + 1,
    lastAttemptAt: now(),
    lastFailure: (failure || 'Delivery failed').slice(0, 500),
    ...(hold ? { heldAt: now(), holdReason: (failure || 'Outcome unknown').slice(0, 500) } : {}),
  };
}
