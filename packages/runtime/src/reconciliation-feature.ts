import {
  reconciliationFeatureManifest,
  reconciliationOperations,
  type ReconciliationDecision,
} from '@agent-native/contracts';
import type { FeatureHandlerContext, FeatureServer } from './feature.js';
import { isDelegated } from './policy.js';
import { reconciliationHandlers } from './reconciliation.js';
import type { Effect, EffectOutcome, ExecutionContext } from './types.js';

/** What a caller does with held effects. */
export type ReconciliationAction = 'read' | 'resolve';

/**
 * The application's decision on who may reconcile held effects. The application's own policy never
 * sees reconciliation operations, so both checks must apply its membership gate and its
 * integration allowlists.
 */
export interface ReconciliationAccess {
  /** Whether `context` may list held effects (`read`) or decide one (`resolve`) at all. */
  allows(context: ExecutionContext, action: ReconciliationAction): boolean;
  /**
   * Whether `context` may see and decide this held effect, for example because it holds a role
   * on the record the effect reports on. A hidden effect reads as missing.
   */
  sees(context: ExecutionContext, effect: Effect): boolean;
}

/** Application code the reconciliation feature calls inside `reconciliation.resolve`. */
export interface ReconciliationHooks {
  /**
   * The application's part of a decision, in the same transaction: record the outcome on the
   * record the effect reports on, as a target's `onOutcome` would. `outcome` is absent for
   * `not-applied`, when the effect is released for another delivery.
   */
  onResolved?(
    effect: Effect,
    decision: ReconciliationDecision,
    outcome: EffectOutcome | undefined,
  ): void;
}

type Context = FeatureHandlerContext<undefined, unknown, ReconciliationAccess, ReconciliationHooks>;
const ops = reconciliationOperations;

/**
 * Reconciliation as a feature: the held effects of every target a caller may see, and a person's
 * decision for one, which completes or releases the effect through the outbox. It keeps no state
 * and owns no resource type; deciding changes the record the effect reports on.
 */
export function reconciliationFeature(): FeatureServer<
  undefined,
  ReconciliationAccess,
  ReconciliationHooks
> {
  return {
    manifest: reconciliationFeatureManifest,
    handlers: reconciliationHandlers<undefined, unknown>({
      visible: (effect, ctx) => (ctx as Context).access.sees(ctx.context, effect),
      onResolved: (effect, decision, outcome, ctx) =>
        (ctx as Context).hooks.onResolved?.(effect, decision, outcome),
    }),
    authorization: {
      resourceTypes: [],
      port: {
        authorize({ capability, context, access, previousAccess }) {
          const resolve = capability.id === ops.reconciliationResolve.id;
          if (resolve && isDelegated(context)) return { allowed: false, reason: 'PERSON_ONLY' };
          const action = resolve ? 'resolve' : 'read';
          const allowed =
            access.allows(context, action) &&
            (previousAccess === undefined || previousAccess.allows(context, action));
          return allowed ? { allowed: true } : { allowed: false, reason: 'RESOURCE_DENIED' };
        },
        canReadEvent: () => false,
      },
    },
  };
}
