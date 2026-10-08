import { ApplicationError, type JsonValue } from '@agent-native/contracts';
import { type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { own, progress, put, type QualityState, type UsageDecision } from '../domain';
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
  handler(operations.plantSetMember, (input, ctx) => {
    const plant = own(ctx.state.plants, input.plant);
    if (!plant) throw new ApplicationError('NOT_FOUND', 'Plant unavailable');
    if (input.principalId === ctx.context.principalId)
      throw new ApplicationError('FORBIDDEN', 'You cannot change your own plant role');
    if (input.principalId === ctx.state.integrationPrincipalId)
      throw new ApplicationError('FORBIDDEN', 'The integration principal has no plant role');
    if (input.role === null) delete plant.members[input.principalId];
    else put(plant.members, input.principalId, input.role);
    ctx.change(`plant:${input.plant}`, 'authorization.changed');
    return { plant: input.plant, members: { ...plant.members } };
  }),
];
