import { ApplicationError, type JsonValue } from '@agent-native/contracts';
import { membershipHandler, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { plantMembership } from '../contracts/membership';
import { own, progress, type QualityState, type UsageDecision } from '../domain';
import {
  TARGET,
  compact,
  lotOf,
  requireOpen,
  now,
  handler,
  type QualityServices,
} from '../server/context';
import { withoutEffect } from '../server/dto';

/** Usage decisions and plant membership, which only supervisors change. */
export const supervisionHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  handler(operations.decisionSet, (input, ctx) => {
    const lot = lotOf(ctx.state, input.lotId);
    requireOpen(lot);
    const { recorded, required } = progress(ctx.state, lot);
    if (recorded < required)
      throw new ApplicationError('CONFLICT', 'Inspection is incomplete', { recorded, required });
    const decision: UsageDecision = compact({
      code: input.code,
      note: input.note,
      decidedBy: ctx.context.principalId,
      decidedAt: now(ctx),
      sync: 'pending' as const,
      effectId: ctx.enqueue({
        target: TARGET,
        type: 'decision.post',
        resource: `lot:${lot.id}`,
        payload: compact({ lot: lot.id, code: input.code, note: input.note }) as JsonValue,
      }),
    });
    lot.decision = decision;
    lot.status = 'decided';
    ctx.change(`lot:${lot.id}`);
    return {
      lotId: lot.id,
      revision: ctx.getRevision(`lot:${lot.id}`) + 1,
      decision: withoutEffect(decision),
    };
  }),
  membershipHandler<QualityState, QualityServices, typeof plantMembership>(plantMembership, {
    members: (state, plant) => own(state.plants, plant)?.members,
    reserved: (state, principalId) => principalId === state.integrationPrincipalId,
  }),
];
