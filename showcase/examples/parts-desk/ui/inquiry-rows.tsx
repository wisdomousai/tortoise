import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { operations } from '../contracts';
import type { Inquiry } from '../contracts/inquiry';
import { useScreenCommand } from './command';
import { UtilityName } from './common';
import { when } from './format';

/** Quote the call, and close or reopen it, through `inquiry.update`. */
function RowActions({ inquiry }: { inquiry: Inquiry }) {
  const update = useScreenCommand(operations.inquiryUpdate);
  const setStatus = (status: Inquiry['status']) => void update.run({ id: inquiry.id, status });
  const serial = inquiry.transformerSerial;
  return (
    <div className="flex items-center justify-end gap-1">
      {update.error && (
        <span role="alert" className="mr-1 text-xs text-destructive">
          {update.error}
        </span>
      )}
      {inquiry.status !== 'closed' &&
        (serial ? (
          <Button asChild size="xs" variant="outline">
            <Link to="/quotes/new" search={{ serial, inquiry: inquiry.id }}>
              Quote
            </Link>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button size="xs" variant="outline" disabled>
                  Quote
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>The call names no transformer</TooltipContent>
          </Tooltip>
        ))}
      {inquiry.status === 'closed' ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={update.pending}
          onClick={() => setStatus('open')}
        >
          Reopen
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          disabled={update.pending}
          onClick={() => setStatus('closed')}
        >
          Close
        </Button>
      )}
    </div>
  );
}

/**
 * One page of calls. The checkbox of a row selects the call, which the assistant panel then sees;
 * a serial opens the transformer the call is about.
 */
export function InquiryRows({
  inquiries,
  selected,
  onSelect,
}: {
  inquiries: readonly Inquiry[];
  selected: ReadonlySet<string>;
  onSelect: (inquiry: Inquiry, selected: boolean) => void;
}) {
  return (
    <Table className="text-[0.8rem]">
      <TableHeader>
        <TableRow className="text-xs">
          <TableHead className="h-8 w-8">
            <span className="sr-only">Selected</span>
          </TableHead>
          <TableHead className="h-8 w-28">Received</TableHead>
          <TableHead className="h-8">Caller</TableHead>
          <TableHead className="h-8">Utility</TableHead>
          <TableHead className="h-8">Serial</TableHead>
          <TableHead className="h-8 w-full">Subject</TableHead>
          <TableHead className="h-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {inquiries.map((inquiry) => (
          <TableRow key={inquiry.id} data-state={selected.has(inquiry.id) ? 'selected' : undefined}>
            <TableCell className="py-1.5">
              <input
                type="checkbox"
                aria-label={`Select the call from ${inquiry.caller}`}
                className="size-4 align-middle accent-primary"
                checked={selected.has(inquiry.id)}
                onChange={(event) => onSelect(inquiry, event.target.checked)}
              />
            </TableCell>
            <TableCell className="py-1.5 text-muted-foreground tabular">
              {when(inquiry.createdAt)}
            </TableCell>
            <TableCell className="py-1.5">{inquiry.caller}</TableCell>
            <TableCell className="max-w-52 py-1.5">
              <UtilityName customerId={inquiry.customerId} />
            </TableCell>
            <TableCell className="py-1.5 font-mono">
              {inquiry.transformerSerial ? (
                <Link
                  to={`/transformers/${inquiry.transformerSerial}`}
                  search={{ inquiry: inquiry.id }}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {inquiry.transformerSerial}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="max-w-0 truncate py-1.5" title={inquiry.subject}>
              {inquiry.subject}
            </TableCell>
            <TableCell className="py-1.5">
              <RowActions inquiry={inquiry} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
