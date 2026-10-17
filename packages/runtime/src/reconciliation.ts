import {
  ApplicationError,
  reconciliationOperations,
  type HeldEffect,
  type ReconciliationDecision,
} from '@agent-native/contracts';
import type { Effect, EffectOutcome, HandlerContext, HandlerContribution } from './types.js';

type Ops = typeof reconciliationOperations;

export interface ReconciliationOptions<State, Services> {
  /**
   * Whether the caller may see and decide a held effect, for example because they hold a role
   * on the record it reports on. Applied before the list is filtered and returned, and by
   * resolve, so a hidden effect reads as missing. Policy cannot see effects; this can.
   */
  readonly visible: (effect: Effect, context: HandlerContext<State, Services>) => boolean;
  /**
   * The domain's part of a decision, in the same transaction: record the outcome on the record
   * the effect reports on, as a target's `onOutcome` would. `outcome` is absent for
   * `not-applied`, when the effect is released for another delivery.
   */
  readonly onResolved?: (
    effect: Effect,
    decision: ReconciliationDecision,
    outcome: EffectOutcome | undefined,
    context: HandlerContext<State, Services>,
  ) => void;
}

function heldView(effect: Effect): HeldEffect {
  return {
    id: effect.id,
    target: effect.target,
    type: effect.type,
    resource: effect.resource,
    operation: effect.operation,
    principalId: effect.principalId,
    payload: effect.payload,
    createdAt: effect.createdAt,
    heldAt: effect.heldAt!,
    ...(effect.holdReason ? { holdReason: effect.holdReason } : {}),
    attempts: effect.attempts,
    ...(effect.contractVersion ? { contractVersion: effect.contractVersion } : {}),
  };
}

/**
 * Handlers for `reconciliationOperations`: the held effects of every target a caller may see,
 * and a person's decision for one. Deciding settles or releases the effect through the outbox
 * like any domain command, so the dispatcher never retries a held effect on its own.
 */
export function reconciliationHandlers<State, Services>(
  options: ReconciliationOptions<State, Services>,
): HandlerContribution<State, Services>[] {
  const list: HandlerContribution<State, Services, Ops['reconciliationList']> = {
    capability: reconciliationOperations.reconciliationList,
    handle(input, ctx) {
      const items = ctx
        .effects({
          status: 'pending',
          held: true,
          ...(input.target ? { target: input.target } : {}),
        })
        .filter((effect) => options.visible(effect, ctx))
        .filter((effect) => input.resource === undefined || effect.resource === input.resource)
        .map(heldView);
      return { items };
    },
  };
  const resolve: HandlerContribution<State, Services, Ops['reconciliationResolve']> = {
    capability: reconciliationOperations.reconciliationResolve,
    handle(input, ctx) {
      const effect = ctx
        .effects({ status: 'pending', held: true })
        .find((candidate) => candidate.id === input.effectId);
      if (!effect || !options.visible(effect, ctx))
        throw new ApplicationError('NOT_FOUND', 'No held effect to reconcile');
      const outcome: EffectOutcome | undefined =
        input.decision === 'applied'
          ? {
              status: 'accepted',
              externalRef: input.externalRef ?? `reconciled:${ctx.context.principalId}`,
            }
          : input.decision === 'refused'
            ? {
                status: 'rejected',
                code: 'RECONCILED_REFUSED',
                message: input.reason ?? 'Refused by the target, as checked by a person',
              }
            : undefined;
      const changed = outcome ? ctx.settleEffect(effect.id, outcome) : ctx.releaseEffect(effect.id);
      ctx.change(effect.resource);
      options.onResolved?.(effect, input.decision, outcome, ctx);
      return { effectId: effect.id, status: changed.status as 'accepted' | 'rejected' | 'pending' };
    },
  };
  return [list, resolve] as HandlerContribution<State, Services>[];
}
