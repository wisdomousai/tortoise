import { ApplicationError, type InputOf, type OutputOf } from '@agent-native/contracts';
import type { HandlerContribution, EffectOutcome } from '@agent-native/runtime';
import { operations } from '../contracts';
import { MES, bridgeStation, hmiTarget, own, put, type LineState } from '../domain';
import { now, handler, type Context, type LineServices } from '../server/context';
import { applyOutcome } from '../server/sync';

/** Apply an MES batch of orders and reasons over the current watermark. */
function syncMes(
  input: InputOf<typeof operations.mesSync>,
  ctx: Context,
): OutputOf<typeof operations.mesSync> {
  // Watermarks order sync batches; a stale or replayed range cannot reapply old data.
  if (input.from !== ctx.state.watermark)
    throw new ApplicationError('CONFLICT', 'Watermark changed', {
      watermark: ctx.state.watermark ?? null,
    });
  for (const { closed, ...snapshot } of input.orders) {
    // Orders for unknown stations are ignored; stations are configured, never inferred.
    if (!own(ctx.state.stations, snapshot.station)) continue;
    const existing = own(ctx.state.orders, snapshot.id);
    put(ctx.state.orders, snapshot.id, {
      ...snapshot,
      status: closed ? 'completed' : (existing?.status ?? 'released'),
    });
    ctx.change(`order:${snapshot.id}`);
  }
  for (const reason of input.reasons ?? []) put(ctx.state.reasons, reason.code, { ...reason });
  ctx.state.watermark = input.to;
  ctx.state.lastSyncAt = now(ctx);
  ctx.change('mes:sync');
  return { watermark: input.to, orders: input.orders.length };
}

/** Settle a forwarded record or screen procedure; each integration settles only its own target. */
function settleEffect(
  input: InputOf<typeof operations.effectSettle>,
  ctx: Context,
): OutputOf<typeof operations.effectSettle> {
  const effect = ctx.effects().find((candidate) => candidate.id === input.effectId);
  if (!effect) throw new ApplicationError('NOT_FOUND', 'Effect unavailable');
  // Each integration principal settles only its own target, checked against the effect here.
  const bridge = bridgeStation(ctx.state, ctx.context.principalId);
  const own =
    (bridge !== undefined && effect.target === hmiTarget(bridge.id)) ||
    (ctx.context.principalId === ctx.state.mesPrincipalId && effect.target === MES);
  if (!own) throw new ApplicationError('FORBIDDEN', 'Effect belongs to another integration');
  const settled = ctx.settleEffect(effect.id, input.outcome as EffectOutcome);
  return {
    resource: settled.resource,
    sync: applyOutcome(ctx, settled, input.outcome as EffectOutcome),
  };
}

/** MES sync and outcome settlement by integration principals. */
export function integrationHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [handler(operations.mesSync, syncMes), handler(operations.effectSettle, settleEffect)];
}
