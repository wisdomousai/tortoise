import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';
import type { Quote } from '../contracts/quote';
import { euro, stockTone, toneClass, when } from './format';

/** Units on the shelf: success in stock, warning at three or fewer, destructive at none. */
export function StockBadge({ stock }: { stock: number }) {
  return (
    <Badge variant="outline" className={cn('tabular', toneClass[stockTone(stock)])}>
      {stock === 0 ? 'Out of stock' : `${stock} in stock`}
    </Badge>
  );
}

/** Days to supply a part when the shelf is empty. */
export function LeadTime({ days }: { days: number }) {
  return <span className="text-xs text-muted-foreground tabular">{days} d lead time</span>;
}

/** A utility's name and account, read by ID. */
export function UtilityName({
  customerId,
  account = true,
}: {
  customerId: string;
  account?: boolean;
}) {
  const query = useQuery(live.liveQueryOptions(operations.customerGet, { id: customerId }));
  const customer = query.data;
  if (!customer) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="truncate">
      {customer.name}
      {account && (
        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{customer.account}</span>
      )}
    </span>
  );
}

const statusTone: Record<string, keyof typeof toneClass | undefined> = {
  open: 'warning',
  quoted: 'success',
  closed: 'muted',
  submitted: 'success',
  cancelled: 'muted',
};

/** The status of an inquiry or a quote. */
export function StatusBadge({ status }: { status: string }) {
  const tone = statusTone[status];
  return (
    <Badge variant="outline" className={tone ? toneClass[tone] : undefined}>
      {status}
    </Badge>
  );
}

/** Previous and next page of a list the instance pages. */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-3 pb-2 text-xs text-muted-foreground">
      <span className="tabular">
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <Button
        size="xs"
        variant="outline"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={offset + limit >= total}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </Button>
    </div>
  );
}

/** Quotes as dense rows; a row opens the quote builder. */
export function QuotesTable({
  quotes,
  utility = true,
  empty,
}: {
  quotes: readonly Quote[];
  utility?: boolean;
  empty: string;
}) {
  const navigate = useNavigate();
  if (quotes.length === 0) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table className="text-[0.8rem]">
      <TableHeader>
        <TableRow className="text-xs">
          <TableHead className="h-8">Number</TableHead>
          <TableHead className="h-8">Status</TableHead>
          <TableHead className="h-8">Serial</TableHead>
          {utility && <TableHead className="h-8">Utility</TableHead>}
          <TableHead className="h-8 text-right">Lines</TableHead>
          <TableHead className="h-8 text-right">Discount</TableHead>
          <TableHead className="h-8 text-right">Total</TableHead>
          <TableHead className="h-8">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {quotes.map((quote) => (
          <TableRow
            key={quote.id}
            className="cursor-pointer"
            onClick={() => void navigate({ to: `/quotes/${quote.id}` })}
          >
            <TableCell className="py-1.5 font-mono">
              <Link
                to={`/quotes/${quote.id}`}
                className="hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {quote.number}
              </Link>
            </TableCell>
            <TableCell className="py-1.5">
              <StatusBadge status={quote.status} />
            </TableCell>
            <TableCell className="py-1.5 font-mono">{quote.transformerSerial}</TableCell>
            {utility && (
              <TableCell className="max-w-56 py-1.5">
                <UtilityName customerId={quote.customerId} account={false} />
              </TableCell>
            )}
            <TableCell className="py-1.5 text-right tabular">{quote.lines.length}</TableCell>
            <TableCell className="py-1.5 text-right tabular">
              {quote.discountPercent ? `${quote.discountPercent} %` : '—'}
            </TableCell>
            <TableCell className="py-1.5 text-right font-medium tabular">
              {euro(quote.total)}
            </TableCell>
            <TableCell className="py-1.5 text-muted-foreground tabular">
              {when(quote.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
