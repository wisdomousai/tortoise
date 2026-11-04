import { useQuery } from '@tanstack/react-query';
import { reconciliationOperations } from '@tortoise/contracts';
import { ReconciliationReview, type HeldEffect } from '@/components/reconciliation-review';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { eamTarget, type RepairOrderPayload } from '../contracts/eam-target';
import { formatDate } from '@/lib/fields';

/** A held repair order by its asset tag, so the person knows which tool to look up in the EAM. */
const describe = (effect: HeldEffect) =>
  `Repair order for ${(effect.payload as Partial<RepairOrderPayload>).assetTag ?? effect.resource}`;

/**
 * Delivery to the plant EAM: repair orders waiting, held, accepted and rejected, the last feed
 * sync, and the held repair orders. For a held one, the person looks for the order in the EAM:
 * applied with the repair order number found there, not applied to send it again, or refused with
 * the EAM's reason. Viewers see the list and are refused on decision.
 */
export function EamScreen() {
  const status = useQuery(live.liveQueryOptions(operations.eamStatus, {}));
  const rows: [string, string][] = [
    ['Waiting', String(status.data?.pending ?? 0)],
    ['Held for a decision', String(status.data?.held ?? 0)],
    ['Accepted', String(status.data?.accepted ?? 0)],
    ['Rejected', String(status.data?.rejected ?? 0)],
    ['Last feed sync', status.data?.lastSyncAt ? formatDate(status.data.lastSyncAt) : 'Never'],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">EAM</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        For a held repair order, find it in the EAM by asset tag. Enter its repair order number and
        choose Applied, choose Not applied to send it again, or enter the EAM's reason and choose
        Refused.
      </p>
      <ReconciliationReview
        title="Held repair orders"
        list={reconciliationOperations.reconciliationList}
        resolve={reconciliationOperations.reconciliationResolve}
        target={eamTarget.target}
        describe={describe}
      />
    </div>
  );
}
