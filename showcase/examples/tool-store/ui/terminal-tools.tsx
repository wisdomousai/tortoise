import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '@tortoise/workstation-sign-in/plugin-screens';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { operations } from '../contracts';
import type { Tool } from '../contracts/tool';
import type { SelectedTool } from './terminal-runs';

const PAGE = 25;

/** Keep a click or Enter on the checkbox from reaching the row, which opens the tool. */
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

/**
 * The tools of the terminal's Tools tab, newest first, read as the signed-in attendant. Each row
 * has a checkbox that adds the tool to the work area's selection, and a row opens its tool on the
 * Counter tab. `tool.list` gives each tool its revision, and every page read hands its rows to
 * `onRows`, so the selection keeps the revision its row shows. The instance pages and counts the
 * list.
 */
export function TerminalTools({
  selected,
  onToggle,
  onRows,
  onOpen,
}: {
  selected: readonly SelectedTool[];
  onToggle: (tool: Tool, selected: boolean) => void;
  onRows: (rows: readonly Tool[]) => void;
  onOpen: (tool: Tool) => void;
}) {
  const { live } = useOperatorSession();
  const [offset, setOffset] = useState(0);
  const query = useQuery(live.liveQueryOptions(operations.toolList, { offset, limit: PAGE }));
  const data = query.data as { items: Tool[]; total: number } | undefined;
  useEffect(() => {
    if (data) onRows(data.items);
  }, [data]);
  const ticked = new Set(selected.map((tool) => tool.id));
  const columns: LiveColumn<Tool>[] = [
    {
      id: 'select',
      header: () => <span className="sr-only">Selected</span>,
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${row.original.assetTag}`}
          checked={ticked.has(row.original.id)}
          onCheckedChange={(checked) => onToggle(row.original, checked === true)}
          onClick={stop}
          onKeyDown={stop}
        />
      ),
    },
    { id: 'assetTag', header: 'Asset tag', cell: ({ row }) => row.original.assetTag },
    { id: 'description', header: 'Description', cell: ({ row }) => row.original.description },
    { id: 'bin', header: 'Bin', cell: ({ row }) => row.original.bin },
    { id: 'status', header: 'Status', cell: ({ row }) => row.original.status },
    {
      id: 'calibrationDue',
      header: 'Calibration due',
      cell: ({ row }) => row.original.calibrationDue ?? '',
    },
  ];
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Tools</h2>
      <p className="text-sm text-muted-foreground">
        Tick the tools an agent run works on. A row opens its tool on the Counter tab.
      </p>
      <LiveDataTable
        columns={columns}
        rows={data?.items ?? []}
        count={data?.total ?? 0}
        offset={offset}
        limit={PAGE}
        onOffset={setOffset}
        onRowOpen={onOpen}
        rowLabel={(row) => `${row.assetTag} ${row.description}`}
        empty="No tools yet."
      />
    </div>
  );
}
