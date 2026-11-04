import type { ReactNode } from 'react';
import { CircleAlert, Clock3 } from 'lucide-react';
import type { OutputOf } from '@tortoise/contracts';
import type { operations } from '../../contracts';
import type { LiveColumn } from '@/components/live-data-table';
import { cn } from '@/lib/utils';

type Lot = OutputOf<typeof operations.lotList>['items'][number];

const nextStep = (lot: Lot) =>
  lot.status !== 'open'
    ? 'View'
    : lot.recorded >= lot.required
      ? 'Decide'
      : lot.recorded > 0
        ? 'Continue'
        : 'Start';

/** The lot worklist: what, progress, next step and synchronization per lot. */
export const columns: LiveColumn<Lot>[] = [
  {
    accessorKey: 'id',
    header: 'Lot',
    cell: (info) => (
      <span className="font-mono text-[0.95rem] font-semibold">{info.getValue<string>()}</span>
    ),
  },
  {
    id: 'material',
    header: 'Material',
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-medium">{row.original.materialText}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.material}
          {row.original.batch ? ` · batch ${row.original.batch}` : ''} · plant {row.original.plant}
        </div>
      </div>
    ),
  },
  {
    id: 'progress',
    header: 'Measured',
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 w-28 rounded-full bg-foreground/10">
          <div
            className="h-1.5 rounded-full bg-primary"
            style={{
              width: `${(100 * row.original.recorded) / Math.max(1, row.original.required)}%`,
            }}
          />
        </div>
        <span className="font-mono text-xs">
          {row.original.recorded} / {row.original.required}
        </span>
      </div>
    ),
  },
  {
    id: 'results',
    header: 'Results',
    cell: ({ row }) =>
      row.original.outOfTolerance > 0 ? (
        <Pill tone="fault">
          <CircleAlert className="size-3.5" aria-hidden />
          {row.original.outOfTolerance} out of tolerance
        </Pill>
      ) : (
        <span className="text-sm text-muted-foreground">
          {row.original.recorded ? 'All in tolerance' : 'Not started'}
        </span>
      ),
  },
  {
    id: 'sync',
    header: 'Quality system',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1.5">
        {row.original.rejectedSync > 0 && (
          <Pill tone="fault">
            <CircleAlert className="size-3.5" aria-hidden />
            {row.original.rejectedSync} rejected
          </Pill>
        )}
        {row.original.pendingSync > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-amber-800">
            <Clock3 className="size-3.5" aria-hidden />
            {row.original.pendingSync} sending
          </span>
        )}
        {!row.original.rejectedSync && !row.original.pendingSync && (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>
    ),
  },
  {
    id: 'open',
    header: () => <span className="sr-only">Next step</span>,
    // The row itself opens the lot (click or Enter); this is its visible label, not a second control.
    cell: ({ row }) => {
      const step = nextStep(row.original);
      return (
        <span
          aria-hidden
          className={cn(
            'inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium',
            step === 'Continue' || step === 'Decide'
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-card',
          )}
        >
          {step}
        </span>
      );
    },
  },
];

function Pill({ tone, children }: { tone: 'fault'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium',
        tone === 'fault' && 'bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </span>
  );
}
