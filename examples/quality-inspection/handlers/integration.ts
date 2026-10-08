import { ApplicationError } from '@agent-native/contracts';
import { type EffectOutcome, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { own, put, type QualityState, type Synchronized } from '../domain';
import { compact, now, handler, type QualityServices } from '../server/context';

/** Inbound lot sync and outbound settlement, for the integration principal only. */
export const integrationHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  handler(operations.lotSync, (input, ctx) => {
    // Watermarks make sync batches ordered; a stale or replayed range cannot reapply old data.
    if (input.from !== ctx.state.watermark)
      throw new ApplicationError('CONFLICT', 'Watermark changed', {
        watermark: ctx.state.watermark ?? null,
      });
    for (const snapshot of input.lots) {
      if (!own(ctx.state.plants, snapshot.plant))
        // New plants start without members; access is granted explicitly, never inferred.
        put(ctx.state.plants, snapshot.plant, { members: {} });
      const existing = own(ctx.state.lots, snapshot.id);
      const { closed, ...master } = snapshot;
      const status = existing?.status ?? 'open';
      put(
        ctx.state.lots,
        snapshot.id,
        compact({
          ...master,
          status: closed && status === 'open' ? ('closed' as const) : status,
          decision: existing?.decision,
        }),
      );
      ctx.change(`lot:${snapshot.id}`);
    }
    for (const group of input.codeGroups ?? []) put(ctx.state.codeGroups, group.id, group);
    ctx.state.watermark = input.to;
    ctx.state.lastSyncAt = now(ctx);
    ctx.change('sync:quality');
    return { watermark: input.to, lots: input.lots.length };
  }),
  handler(operations.effectSettle, (input, ctx) => {
    const effect = ctx.settleEffect(input.effectId, input.outcome as EffectOutcome);
    const separator = effect.resource.indexOf(':');
    const type = effect.resource.slice(0, separator);
    const id = effect.resource.slice(separator + 1);
    const record: Synchronized | undefined =
      type === 'result'
        ? own(ctx.state.results, id)
        : type === 'defect'
          ? own(ctx.state.defects, id)
          : type === 'lot'
            ? own(ctx.state.lots, id)?.decision
            : undefined;
    if (!record || record.effectId !== effect.id)
      throw new ApplicationError('NOT_FOUND', 'Synchronized record unavailable');
    record.sync = input.outcome.status;
    if (input.outcome.status === 'accepted' && input.outcome.externalRef)
      record.sorRef = input.outcome.externalRef;
    if (input.outcome.status === 'rejected')
      record.rejection = { code: input.outcome.code, message: input.outcome.message };
    // Only the forwarded record changes; a settlement must not invalidate a supervisor's review.
    ctx.change(effect.resource);
    return { resource: effect.resource, sync: record.sync };
  }),
];
