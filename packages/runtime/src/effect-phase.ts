import type { Effect } from './types.js';

/**
 * Where an outbox effect is in delivery and reconciliation, derived from its record:
 *
 * - `queued`: committed, never attempted; a command may still cancel it.
 * - `claimed`: a worker holds a live claim and may be delivering it now.
 * - `retrying`: an attempt failed transiently; it is delivered again after backoff.
 * - `acknowledged`: the target acknowledged it and has not decided; its lookup is polled.
 * - `held`: nobody can tell whether the target applied it, or its actor lost the right to send
 *   it; it waits for a reconciliation command (complete or release), never for a retry.
 * - `accepted`, `rejected`: completed with the target's outcome.
 * - `cancelled`: withdrawn before any worker claimed it; never sent.
 *
 * Transitions happen only through the outbox: claim (queued, retrying or acknowledged to claimed,
 * or to held when the dispatch recheck denies), attempt (claimed to retrying, acknowledged or held),
 * complete (to accepted or rejected), release (held to queued) and cancel (queued to cancelled).
 * A claim whose lease lapsed reads as the phase before it.
 */
export type EffectPhase =
  | 'queued'
  | 'claimed'
  | 'retrying'
  | 'acknowledged'
  | 'held'
  | 'accepted'
  | 'rejected'
  | 'cancelled';

export function effectPhase(effect: Effect, now: number): EffectPhase {
  if (effect.status !== 'pending') return effect.status;
  if (effect.heldAt !== undefined) return 'held';
  if (effect.claim && effect.claim.expiresAt > now) return 'claimed';
  if (effect.acknowledgedAt !== undefined) return 'acknowledged';
  return effect.attempts > 0 ? 'retrying' : 'queued';
}
