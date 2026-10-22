import { settleDelivery } from '@agent-native/integration';
import { records, type Effect, type EffectOutcome } from '@agent-native/runtime';
import { deliveries } from '../contracts/delivery';
import type { Context } from './context';

/**
 * The reconciliation feature's `onResolved` hook, for goods receipts the ERP may or may not have
 * booked, for example when its receipt file could not be read. An outcome lands on the line's
 * posting as the ERP's own would, in the same transaction; a receipt sent again stays pending.
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
    settleDelivery(record.posting, effect, outcome);
    if (outcome.status === 'rejected') record.status = 'counted';
  });
}
