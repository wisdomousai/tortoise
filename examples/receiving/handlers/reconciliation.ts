import { settleDelivery } from '@agent-native/integration';
import { reconciliationHandlers as handlersOf, records } from '@agent-native/runtime';
import { deliveries } from '../contracts/delivery';
import type { AppState } from '../domain';
import type { Services } from './context';

/**
 * Goods receipts the ERP may or may not have booked, for example when its receipt file could not
 * be read. Every member sees them, as they see every line; the policy lets editors decide. An
 * outcome lands on the line's posting as the ERP's own would; a receipt sent again stays pending.
 */
export function reconciliationHandlers() {
  return handlersOf<AppState, Services>({
    visible: (effect) => effect.resource.startsWith('delivery:'),
    onResolved(effect, _decision, outcome, ctx) {
      if (!outcome) return;
      const id = effect.resource.slice('delivery:'.length);
      records(ctx, deliveries, ctx.state.deliveries).update(id, (record) => {
        settleDelivery(record.posting, effect, outcome);
        if (outcome.status === 'rejected') record.status = 'counted';
      });
    },
  });
}
