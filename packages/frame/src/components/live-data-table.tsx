import { tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const liveTableFeatures = tableFeatures({});
export type LiveColumn<Row extends RowData> = ColumnDef<typeof liveTableFeatures, Row>;

/** Previous and next over the server's page window; `count` is what this principal may see. */
function Pager({
  count,
  offset,
  limit,
  onOffset,
}: {
  count: number;
  offset: number;
  limit: number;
  onOffset: (offset: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <span className="tabular">
        {offset + 1}–{Math.min(offset + limit, count)} of {count}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={offset + limit >= count}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </Button>
    </div>
  );
}

/**
 * Table over a server-scoped, server-paginated capability result. The instance filters and
 * counts before paginating, so `count` is the number of rows this principal may see; the table
 * never paginates or filters client-side over a partial set.
 */
export function LiveDataTable<Row extends RowData>({
  columns,
  rows,
  count,
  offset,
  limit,
  onOffset,
  onRowOpen,
  rowLabel,
  empty = 'Nothing here yet.',
}: {
  columns: LiveColumn<Row>[];
  rows: Row[];
  count: number;
  offset: number;
  limit: number;
  onOffset: (offset: number) => void;
  onRowOpen?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  empty?: string;
}) {
  const table = useTable({ features: liveTableFeatures, columns, data: rows });
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={onRowOpen ? 0 : undefined}
                aria-label={rowLabel?.(row.original)}
                className={onRowOpen ? 'cursor-pointer' : undefined}
                onClick={() => onRowOpen?.(row.original)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onRowOpen?.(row.original);
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-20 text-center text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {count > limit && <Pager count={count} offset={offset} limit={limit} onOffset={onOffset} />}
    </div>
  );
}
