import type { z } from 'zod';
import { ApplicationError } from '@agent-native/contracts';
import { completeDelivery, targetHandlers } from '@agent-native/integration';
import type { EffectOutcome, HandlerContribution } from '@agent-native/runtime';
import { accountSnapshotSchema } from '../contracts/schemas';
import { crmTarget } from '../contracts/target';
import { coversRegion, type CrmState } from '../domain';
import {
  accountRecords,
  activityRecords,
  now,
  TARGET,
  type Context,
  type CrmServices,
} from './context';

/** A follow request completes its account; accepted keeps it requested until the feed delivers it. */
function completeFollow(ctx: Context, id: string, effectId: string, outcome: EffectOutcome) {
  const account = accountRecords(ctx).get(id);
  if (!account || account.effectId !== effectId)
    throw new ApplicationError('NOT_FOUND', 'Followed account unavailable');
  if (outcome.status === 'rejected') {
    account.status = 'rejected';
    account.rejection = { code: outcome.code, message: outcome.message };
  }
}

/** The CRM feed, outbox completion and synchronization status. */
export const integrationHandlers = (): HandlerContribution<CrmState, CrmServices>[] =>
  targetHandlers<CrmState, CrmServices, z.output<typeof accountSnapshotSchema>>(crmTarget, {
    cursor: (state) => state,
    now,
    onOutcome(effect, outcome, ctx) {
      const separator = effect.resource.indexOf(':');
      const [type, id] = [
        effect.resource.slice(0, separator),
        effect.resource.slice(separator + 1),
      ];
      if (type === 'account') completeFollow(ctx, id, effect.id, outcome);
      else
        completeDelivery(
          type === 'activity' ? activityRecords(ctx).get(id) : undefined,
          effect,
          outcome,
        );
    },
    applyBatch({ items }, ctx) {
      const accounts = accountRecords(ctx);
      let applied = 0;
      for (const { externalId, ...details } of items) {
        // The feed only carries accounts this workspace follows; anything else is ignored.
        const account = accounts.get(externalId);
        if (!account || account.status === 'rejected') continue;
        accounts.update(
          externalId,
          { ...details, status: 'following', syncedAt: now(ctx) },
          'synced',
        );
        applied++;
      }
      return applied;
    },
    status(ctx) {
      // Region scope first: accounts outside the caller's regions are not counted.
      const visible = Object.values(ctx.state.accounts).filter((account) =>
        coversRegion(ctx.state, ctx.context.principalId, account.region),
      );
      const count = (status: string) =>
        visible.filter((account) => account.status === status).length;
      return {
        requested: count('requested'),
        following: count('following'),
        rejected: count('rejected'),
        pending: ctx.effects({ status: 'pending', target: TARGET }).length,
      };
    },
  });
