import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert, Clock3, ScanBarcode, Search } from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { operations } from '../contracts';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { useScannerInput } from '@agent-native/react/capture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';

type Lot = OutputOf<typeof operations.lotList>['items'][number];
type Status = 'open' | 'decided' | 'closed';
const PAGE = 25;
const tabs: { status: Status; label: string }[] = [
  { status: 'open', label: 'To measure' },
  { status: 'decided', label: 'Decided' },
  { status: 'closed', label: 'Closed' },
];

/** What the row offers: start a fresh lot, continue one, or review a fully measured one. */
const nextStep = (lot: Lot) =>
  lot.status !== 'open'
    ? 'View'
    : lot.recorded >= lot.required
      ? 'Decide'
      : lot.recorded > 0
        ? 'Continue'
        : 'Start';

const columns: LiveColumn<Lot>[] = [
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

/**
 * Inspection lots at the person's plants. Scanning a lot label is the main way in; the table is
 * the worklist. Counts per tab are server counts for that status, never computed from a page.
 */
export function LotsScreen() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('open');
  const [offset, setOffset] = useState(0);
  const [typed, setTyped] = useState('');
  const filter = search.trim() ? { search: search.trim() } : {};
  const lots = useQuery(
    live.liveQueryOptions(operations.lotList, { offset, limit: PAGE, status, ...filter }),
  );
  const open = (lotId: string) => void navigate({ to: '/inspection/$lotId', params: { lotId } });
  // A scanned lot label opens its capture station from anywhere on this screen.
  useScannerInput({ onScan: open });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Lots</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lots and specifications come from the quality system. What you record here is sent back to
          it.
        </p>
      </header>
      <section
        aria-label="Open a lot"
        className="flex flex-wrap items-center gap-5 rounded-2xl border-2 border-dashed border-primary/25 bg-card p-6"
      >
        <div className="flex size-14 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ScanBarcode className="size-7" aria-hidden />
        </div>
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 className="text-xl font-semibold">Scan a lot label to start measuring</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The scanner works anywhere on this screen. Or type the lot number.
          </p>
        </div>
        <form
          className="flex min-w-0 flex-[1_1_20rem] gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) open(typed.trim());
          }}
        >
          <Input
            aria-label="Lot number"
            placeholder="Lot number"
            className="h-12 flex-1 font-mono text-lg md:text-lg"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button type="submit" className="h-12 px-5 text-[0.95rem]">
            Open lot
          </Button>
        </form>
      </section>
      <section aria-label="Lots" className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5">
          <Tabs
            value={status}
            onValueChange={(value) => {
              setStatus(value as Status);
              setOffset(0);
            }}
          >
            <TabsList aria-label="Lot status" className="h-10! p-1">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.status}
                  value={tab.status}
                  // The page background is tinted, so the active tab takes the card white.
                  className="px-3.5 data-active:bg-card"
                >
                  {tab.label}
                  <TabCount status={tab.status} filter={filter} />
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <label className="flex h-10 min-w-0 flex-[0_1_18rem] items-center gap-2 rounded-lg border border-input px-3 text-muted-foreground">
            <Search className="size-4" aria-hidden />
            <input
              aria-label="Search lots"
              placeholder="Material, batch or lot"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
        {lots.error && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {lots.error.message}
          </p>
        )}
        <div className="px-2 pb-2">
          <LiveDataTable
            columns={columns}
            rows={lots.data?.items ?? []}
            count={lots.data?.count ?? 0}
            offset={offset}
            limit={PAGE}
            onOffset={setOffset}
            rowLabel={(lot) => `Inspect lot ${lot.id}`}
            onRowOpen={(lot) => open(lot.id)}
            empty={lots.isPending ? 'Loading lots…' : 'No lots at your plants match.'}
          />
        </div>
      </section>
    </div>
  );
}

/** The server's count for one status tab, with the current search applied. */
function TabCount({ status, filter }: { status: Status; filter: { search?: string } }) {
  const count = useQuery(
    live.liveQueryOptions(operations.lotList, { offset: 0, limit: 1, status, ...filter }),
  );
  if (!count.data?.count) return null;
  return <span className="font-normal text-muted-foreground tabular-nums">{count.data.count}</span>;
}
