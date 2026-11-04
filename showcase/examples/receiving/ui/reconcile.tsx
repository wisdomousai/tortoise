import { ReconciliationReview } from '@/components/reconciliation-review';
import { reconciliationOperations } from '@tortoise/contracts';

/** Goods receipts whose outcome the ERP did not make clear, for an editor to check and decide. */
export function ReconcileScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Held receipts</h1>
      <ReconciliationReview
        title="Held goods receipts"
        list={reconciliationOperations.reconciliationList}
        resolve={reconciliationOperations.reconciliationResolve}
        describe={(effect) => `Goods receipt for ${effect.resource.slice('delivery:'.length)}`}
      />
    </div>
  );
}
