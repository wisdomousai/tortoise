import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ScanBarcode, Search } from 'lucide-react';
import { operations } from '../contracts';
import { LiveDataTable } from '@/components/live-data-table';
import { columns } from './inspection/lot-columns';
import { useScannerInput } from '@agent-native/react/capture';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { live } from '@/lib/session';

type Status = 'open' | 'decided' | 'closed';
const PAGE = 25;
const tabs: { status: Status; label: string }[] = [
  { status: 'open', label: 'To measure' },
  { status: 'decided', label: 'Decided' },
  { status: 'closed', label: 'Closed' },
];

/** What the row offers: start a fresh lot, continue one, or review a fully measured one. */
/** The way in: a scan anywhere on the screen, or the lot number typed here. */
function OpenLot({ onOpen }: { onOpen: (lotId: string) => void }) {
  const [typed, setTyped] = useState('');
  return (
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
          if (typed.trim()) onOpen(typed.trim());
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
  );
}

/** Status tabs with server counts, and the search they share. Changing either resets paging. */
function LotFilters({
  status,
  search,
  filter,
  onStatus,
  onSearch,
}: {
  status: Status;
  search: string;
  filter: { search?: string };
  onStatus: (status: Status) => void;
  onSearch: (search: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5">
      <Tabs value={status} onValueChange={(value) => onStatus(value as Status)}>
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
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
    </div>
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
      <OpenLot onOpen={open} />
      <section aria-label="Lots" className="overflow-hidden rounded-2xl border bg-card">
        <LotFilters
          status={status}
          search={search}
          filter={filter}
          onStatus={(value) => {
            setStatus(value);
            setOffset(0);
          }}
          onSearch={(value) => {
            setSearch(value);
            setOffset(0);
          }}
        />
        {lots.error && (
          <p role="alert" className="px-4 py-3 text-sm text-destructive">
            {lots.error.message}
          </p>
        )}
        <div className="px-2 pb-2">
          <LiveDataTable
            columns={columns}
            rows={lots.data?.items ?? []}
            count={lots.data?.total ?? 0}
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
  if (!count.data?.total) return null;
  return <span className="font-normal text-muted-foreground tabular-nums">{count.data.total}</span>;
}
