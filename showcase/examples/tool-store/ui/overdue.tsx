import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '@agent-native/workstation-sign-in/plugin-screens';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { operations } from '../contracts';
import type { OverdueLoan } from '../contracts/loan-overdue';

const PAGE = 25;
/** The query depends on the clock, so a loan that falls due while the tab is open appears. */
const REFRESH_MS = 30_000;

const columns: LiveColumn<OverdueLoan>[] = [
  { id: 'assetTag', header: 'Asset tag', cell: ({ row }) => row.original.assetTag },
  { id: 'description', header: 'Tool', cell: ({ row }) => row.original.description },
  { id: 'borrower', header: 'Borrower', cell: ({ row }) => row.original.borrower },
  { id: 'workOrder', header: 'Work order', cell: ({ row }) => row.original.workOrder },
  { id: 'dueAt', header: 'Due', cell: ({ row }) => row.original.dueAt },
];

/**
 * The Overdue tab of the counter terminal: open loans past their due time, oldest due first, read
 * as the signed-in attendant. The query depends on loans and tools, so a check-out or a return
 * updates the list without a reload. A row opens its tool on the Counter tab.
 */
export function OverdueList({ onOpen }: { onOpen: (loan: OverdueLoan) => void }) {
  const { live } = useOperatorSession();
  const [offset, setOffset] = useState(0);
  // #region query
  const query = useQuery({
    ...live.liveQueryOptions(operations.loanOverdue, { offset, limit: PAGE }),
    refetchInterval: REFRESH_MS,
  });
  // #endregion query
  const data = query.data as { items: OverdueLoan[]; total: number } | undefined;
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Overdue</h2>
      <LiveDataTable
        columns={columns}
        rows={data?.items ?? []}
        count={data?.total ?? 0}
        offset={offset}
        limit={PAGE}
        onOffset={setOffset}
        onRowOpen={onOpen}
        rowLabel={(row) => `${row.assetTag} ${row.borrower}`}
        empty="No tools are overdue."
      />
    </div>
  );
}
