import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CapabilityForm } from '@/components/capability-form';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { toolCategories, toolStatuses, type Tool } from '../contracts/tool';
import { useOpenAtTerminal } from './counter-scanner';

const PAGE = 25;
const words = (value: string) => value.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const columns: LiveColumn<Tool>[] = [
  { id: 'assetTag', header: 'Asset tag', cell: ({ row }) => row.original.assetTag },
  { id: 'description', header: 'Description', cell: ({ row }) => row.original.description },
  { id: 'bin', header: 'Bin', cell: ({ row }) => row.original.bin },
  { id: 'status', header: 'Status', cell: ({ row }) => words(row.original.status) },
];

/**
 * The tool list: asset tag, description, bin and status, with the status and category filters and
 * the search box sent to the list query, so the instance filters and counts before paging. A row
 * opens its tool at the counter terminal.
 */
function ToolList() {
  const openAtTerminal = useOpenAtTerminal();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  // A changed filter starts again at the first page.
  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setOffset(0);
  };
  const input = {
    offset,
    limit: PAGE,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
  };
  const query = useQuery(live.liveQueryOptions(operations.toolList, input as never));
  const data = query.data as { items: Tool[]; total: number } | undefined;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tools</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Search tools"
            placeholder="Search asset tag or description"
            className="w-64"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
          />
          <NativeSelect
            aria-label="Filter by status"
            value={status}
            onChange={(event) => change(setStatus)(event.target.value)}
          >
            <option value="">All statuses</option>
            {toolStatuses.map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filter by category"
            value={category}
            onChange={(event) => change(setCategory)(event.target.value)}
          >
            <option value="">All categories</option>
            {toolCategories.map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </header>
      <LiveDataTable
        columns={columns}
        rows={data?.items ?? []}
        count={data?.total ?? 0}
        offset={offset}
        limit={PAGE}
        onOffset={setOffset}
        onRowOpen={(row) => void openAtTerminal(row.id)}
        rowLabel={(row) => `${row.assetTag} ${row.description}`}
        empty="No tools match."
      />
      <section aria-label={operations.toolCreate.description} className="space-y-3">
        <h2 className="text-base font-medium">New</h2>
        <CapabilityForm capability={operations.toolCreate} submitLabel="Create" />
      </section>
    </div>
  );
}

/** The tool list with its filters; the counter for one tool is at the terminal. */
export const toolRoutes = [{ path: 'tools', component: ToolList }];
