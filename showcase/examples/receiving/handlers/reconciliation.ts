import { completeDelivery } from '@tortoise/integration';
import { records, type Effect, type EffectOutcome } from '@tortoise/runtime';
import { deliveries } from '../contracts/delivery';
import { qualityPeer } from '../contracts/quality-peer';
import type { Context } from './context';

/**
 * The reconciliation feature's `onResolved` hook, for goods receipts the ERP may or may not have
 * booked, for example when its receipt file could not be read, and inspection requests quality inspection
 * may or may not have taken. An outcome is applied to the line's posting or inspection as the
 * target's own would be, in the same transaction; an effect sent again stays pending.
 */
export function onReceiptResolved(
  effect: Effect,
  _decision: unknown,
  outcome: EffectOutcome | undefined,
  ctx: Context,
) {
  if (!outcome) return;
  const id = effect.resource.slice('delivery:'.length);
  records(ctx, deliveries, ctx.state.deliveries).update(id, (record) => {
    if (effect.target === qualityPeer.target) {
      completeDelivery(record.inspection, effect, outcome);
      return;
    }
    completeDelivery(record.posting, effect, outcome);
    if (outcome.status === 'rejected') record.status = 'counted';
  });
}
