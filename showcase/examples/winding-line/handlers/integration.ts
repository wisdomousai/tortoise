import type { z } from 'zod';
import { targetHandlers } from '@tortoise/integration';
import type { HandlerContribution } from '@tortoise/runtime';
import type { orderSnapshotSchema, reasonSchema } from '../contracts/schemas';
import { mesTarget } from '../contracts/target';
import { MES, bridgeStation, hmiTarget, own, put, type LineState } from '../domain';
import { now, type LineServices } from '../server/context';
import { applyOutcome } from '../server/sync';
import { syncStatus } from './queries';

type OrderSnapshot = z.output<typeof orderSnapshotSchema>;
type Extra = { reasons?: z.output<typeof reasonSchema>[] };

/**
 * MES sync, outcome completion and synchronization status. The MES integration completes MES
 * effects and each station bridge completes its own station's screen procedures, checked against
 * the effect inside the completing transaction.
 */
export function integrationHandlers(): HandlerContribution<LineState, LineServices>[] {
  return targetHandlers<LineState, LineServices, OrderSnapshot, Extra>(mesTarget, {
    cursor: (state) => state,
    now,
    mayComplete(effect, ctx) {
      const bridge = bridgeStation(ctx.state, ctx.context.principalId);
      return (
        (bridge !== undefined && effect.target === hmiTarget(bridge.id)) ||
        (ctx.context.principalId === ctx.state.mesPrincipalId && effect.target === MES)
      );
    },
    onOutcome: (effect, outcome, ctx) => void applyOutcome(ctx, effect, outcome),
    applyBatch(batch, ctx) {
      for (const { closed, ...snapshot } of batch.items) {
        // Orders for unknown stations are ignored; stations are configured, never inferred.
        if (!own(ctx.state.stations, snapshot.station)) continue;
        const existing = own(ctx.state.orders, snapshot.id);
        put(ctx.state.orders, snapshot.id, {
          ...snapshot,
          status: closed ? 'completed' : (existing?.status ?? 'released'),
        });
        ctx.change(`order:${snapshot.id}`);
      }
      for (const reason of batch.reasons ?? []) put(ctx.state.reasons, reason.code, { ...reason });
      return batch.items.length;
    },
    status: syncStatus,
  });
}
