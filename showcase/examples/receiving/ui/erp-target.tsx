import { useQuery } from '@tanstack/react-query';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { formatDate } from '@/lib/fields';

/** Goods receipts to the ERP: what is waiting, accepted and rejected, and the last notice import. */
export function ErpScreen() {
  const status = useQuery(live.liveQueryOptions(operations.erpStatus, {}));
  const rows: [string, string][] = [
    ['Waiting', String(status.data?.pending ?? 0)],
    ['Accepted', String(status.data?.accepted ?? 0)],
    ['Rejected', String(status.data?.rejected ?? 0)],
    ['Last notice import', status.data?.lastSyncAt ? formatDate(status.data.lastSyncAt) : 'Never'],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">ERP</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
