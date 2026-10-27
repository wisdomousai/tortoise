import { ApplicationError } from '@agent-native/contracts';
import type { Effect, ExecutionContext } from '../types.js';
import { actorOf } from './audit.js';
import { claimEffect } from './effect-claims.js';
import {
  attemptedEffect,
  byCreation,
  pendingEffect,
  publicEffect,
  putEffect,
  acknowledgedEffect,
} from './effects.js';
import type { Kernel } from './kernel.js';
import { revisionOf } from './records.js';

/**
 * Host-only outbox read for a trusted dispatcher. Transports must not expose it: payloads are
 * unprojected. Business visibility of synchronization goes through authorized domain queries.
 * Held effects wait for reconciliation, not delivery, so they are excluded unless asked for.
 */
async function pendingEffects<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  filter: {
    readonly target?: string;
    readonly limit?: number;
    readonly includeHeld?: boolean;
  } = {},
): Promise<readonly Effect[]> {
  kernel.guard.trusted(context);
  const limit = filter.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new ApplicationError('INVALID_INPUT', 'Invalid effect limit');
  return kernel.options.storage.read(context.workspaceId, async (snapshot) =>
    Object.values(snapshot.effects)
      .filter(
        (effect) =>
          effect.status === 'pending' &&
          (filter.includeHeld || effect.heldAt === undefined) &&
          (filter.target === undefined || effect.target === filter.target),
      )
      .sort(byCreation)
      .slice(0, limit)
      .map(publicEffect),
  );
}

/** What one delivery attempt recorded: a failure (optionally held) or an acknowledgement. */
export interface AttemptRecord {
  readonly hold?: boolean;
  /** The fencing token of the claim this attempt ran under. */
  readonly fence?: number;
  /** The target acknowledged the effect but has not decided it (`acknowledged`). */
  readonly acknowledged?: { readonly externalRef?: string };
}

function recordAttemptInStorage<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  failure: string,
  attempt: AttemptRecord,
): Promise<Effect> {
  return kernel.options.storage.transact(context.workspaceId, async (snapshot) => {
    const effect = pendingEffect(snapshot, id);
    const next = attempt.acknowledged
      ? acknowledgedEffect(effect, attempt.acknowledged.externalRef, kernel.now, attempt.fence)
      : attemptedEffect(effect, failure, attempt.hold, kernel.now, attempt.fence);
    putEffect(snapshot, next);
    snapshot.journal.push({
      cursor: ++snapshot.cursor,
      resource: effect.resource,
      revision: revisionOf(snapshot, effect.resource),
      type: attempt.hold
        ? 'effect.held'
        : attempt.acknowledged
          ? 'effect.acknowledged'
          : 'effect.attempted',
      operation: effect.operation,
    });
    return publicEffect(next);
  });
}

/**
 * Host-only record of a transient delivery failure. It changes framework metadata, not feature
 * state, so the resource revision is unchanged (editors see no false conflict). A journal entry
 * at the current revision still lets authorized subscribers show retry progress.
 *
 * With `hold`, the dispatcher could not tell whether the target applied the effect. The effect
 * stays pending but leaves delivery until a domain command completes or releases it, and the
 * journal records `effect.held` so screens can ask a person to reconcile.
 *
 * With `acknowledged`, the target acknowledged the effect without deciding it. The effect stays
 * pending and the journal records `effect.acknowledged`; dispatchers poll the target from then on.
 * With `fence`, an attempt by a worker whose claim a newer one replaced fails with CONFLICT.
 */
async function recordAttempt<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  failure: string,
  attempt: AttemptRecord = {},
): Promise<Effect> {
  kernel.guard.trusted(context);
  let effect: Effect;
  try {
    effect = await recordAttemptInStorage(kernel, context, id, failure, attempt);
  } catch (error) {
    if (attempt.fence !== undefined) await retainLateAttempt(kernel, context, id, failure, attempt);
    throw error;
  }
  await kernel.audit.after([
    {
      kind: attempt.hold ? 'effect.held' : 'effect.attempted',
      outcome: attempt.acknowledged ? 'info' : 'failed',
      operation: effect.operation,
      resources: [effect.resource],
      actor: actorOf(context),
      data: {
        effectId: effect.id,
        target: effect.target,
        attempts: effect.attempts,
        ...(attempt.acknowledged
          ? { acknowledged: true }
          : { failure: effect.lastFailure ?? 'Delivery failed' }),
      },
    },
  ]);
  return effect;
}

/**
 * A fenced attempt the outbox refused (a newer claim took over, or the effect was completed) is
 * still evidence of what a worker saw at the target. It goes to the audit log as a denied
 * attempt and changes nothing in the workspace.
 */
async function retainLateAttempt<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  failure: string,
  attempt: AttemptRecord,
) {
  const effect = await kernel.options.storage.read(context.workspaceId, async (snapshot) =>
    Object.hasOwn(snapshot.effects, id) ? snapshot.effects[id] : undefined,
  );
  if (!effect) return;
  await kernel.audit.after([
    {
      kind: 'effect.attempted',
      outcome: 'denied',
      operation: effect.operation,
      resources: [effect.resource],
      actor: actorOf(context),
      reason: 'SUPERSEDED',
      data: {
        effectId: id,
        target: effect.target,
        fence: attempt.fence!,
        ...(attempt.acknowledged ? { acknowledged: true } : { failure: failure.slice(0, 500) }),
      },
    },
  ]);
}

/** Host-only outbox access for a trusted dispatcher. No transport may expose these. */
export function createOutbox<State, Services>(kernel: Kernel<State, Services>) {
  return {
    pendingEffects: (context: ExecutionContext, filter?: Parameters<typeof pendingEffects>[2]) =>
      pendingEffects(kernel, context, filter),
    recordAttempt: (
      context: ExecutionContext,
      id: string,
      failure: string,
      attempt?: AttemptRecord,
    ) => recordAttempt(kernel, context, id, failure, attempt),
    claimEffect: (
      context: ExecutionContext,
      id: string,
      claim: Parameters<typeof claimEffect>[3],
    ) => claimEffect(kernel, context, id, claim),
  };
}
