import { ApplicationError } from '@agent-native/contracts';
import type { EffectOutcome, HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { own, type CrmState } from '../domain';
import { handler, now, type CrmServices } from './context';

/** The CRM feed and outbox settlement, for the integration principal only. */
export const integrationHandlers = (): HandlerContribution<CrmState, CrmServices>[] => [
  handler(operations.accountSync, (input, ctx) => {
    // Watermarks order feed batches; a stale or replayed range cannot reapply old snapshots.
    if (input.from !== ctx.state.watermark)
      throw new ApplicationError('CONFLICT', 'Watermark changed', {
        watermark: ctx.state.watermark ?? null,
      });
    let applied = 0;
    for (const snapshot of input.accounts) {
      const account = own(ctx.state.accounts, snapshot.externalId);
      // The feed only carries accounts this workspace follows; anything else is ignored.
      if (!account || account.status === 'rejected') continue;
      const { externalId: _externalId, ...details } = snapshot;
      Object.assign(account, details, { status: 'adopted', syncedAt: now(ctx) });
      ctx.change(`account:${account.id}`, 'synced');
      applied++;
    }
    ctx.state.watermark = input.to;
    ctx.state.lastSyncAt = now(ctx);
    ctx.change('sync:crm');
    return { watermark: input.to, accounts: applied };
  }),
  handler(operations.effectSettle, (input, ctx) => {
    const effect = ctx.settleEffect(input.effectId, input.outcome as EffectOutcome);
    const [type, id = ''] = effect.resource.split(':', 2) as [string, string?];
    if (type === 'account') {
      const account = own(ctx.state.accounts, id);
      if (!account || account.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Followed account unavailable');
      // Accepted keeps `following`: the details arrive with the next feed batch.
      if (input.outcome.status === 'rejected') {
        account.status = 'rejected';
        account.rejection = { code: input.outcome.code, message: input.outcome.message };
      }
    } else {
      const activity = own(ctx.state.activities, id);
      if (type !== 'activity' || !activity || activity.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Forwarded activity unavailable');
      activity.sync = input.outcome.status;
      if (input.outcome.status === 'accepted' && input.outcome.externalRef)
        activity.sorRef = input.outcome.externalRef;
      if (input.outcome.status === 'rejected')
        activity.rejection = { code: input.outcome.code, message: input.outcome.message };
    }
    ctx.change(effect.resource);
    return { resource: effect.resource, sync: input.outcome.status };
  }),
];
