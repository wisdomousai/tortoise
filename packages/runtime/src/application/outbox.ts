import { ApplicationError } from '@agent-native/contracts';
import type { Effect, ExecutionContext } from '../types.js';
import { actorOf } from './audit.js';
import { attemptedEffect, byCreation, pendingEffect, putEffect } from './effects.js';
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
      .slice(0, limit),
  );
}

function recordAttemptInStorage<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  failure: string,
  attempt: { readonly hold?: boolean },
): Promise<Effect> {
  return kernel.options.storage.transact(context.workspaceId, async (snapshot) => {
    const effect = pendingEffect(snapshot, id);
    const next = attemptedEffect(effect, failure, attempt.hold, kernel.now);
    putEffect(snapshot, next);
    snapshot.journal.push({
      cursor: ++snapshot.cursor,
      resource: effect.resource,
      revision: revisionOf(snapshot, effect.resource),
      type: attempt.hold ? 'effect.held' : 'effect.attempted',
      operation: effect.operation,
    });
    return next;
  });
}

/**
 * Host-only record of a transient delivery failure. It changes framework metadata, not feature
 * state, so the resource revision is unchanged (editors see no false conflict). A journal entry
 * at the current revision still lets authorized subscribers show retry progress.
 *
 * With `hold`, the dispatcher could not tell whether the target applied the effect. The effect
 * stays pending but leaves delivery until a domain command settles or releases it, and the
 * journal records `effect.held` so screens can ask a person to reconcile.
 */
async function recordAttempt<State, Services>(
  kernel: Kernel<State, Services>,
  context: ExecutionContext,
  id: string,
  failure: string,
  attempt: { readonly hold?: boolean } = {},
): Promise<Effect> {
  kernel.guard.trusted(context);
  const effect = await recordAttemptInStorage(kernel, context, id, failure, attempt);
  await kernel.audit.after([
    {
      kind: attempt.hold ? 'effect.held' : 'effect.attempted',
      outcome: 'failed',
      operation: effect.operation,
      resources: [effect.resource],
      actor: actorOf(context),
      data: {
        effectId: effect.id,
        target: effect.target,
        attempts: effect.attempts,
        failure: effect.lastFailure ?? 'Delivery failed',
      },
    },
  ]);
  return effect;
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
      attempt?: { readonly hold?: boolean },
    ) => recordAttempt(kernel, context, id, failure, attempt),
  };
}
