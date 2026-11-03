import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';
import { DESK_DISCOUNT_LIMIT, MAX_DISCOUNT, totalOf } from '../contracts/quote';
import { UtilityName } from './common';
import { euro } from './format';
import { MAX_QUANTITY, clampQuantity, type DraftLine, type QuoteDraft } from './quote-drafts';

/** A control that cannot act yet, with the reason on hover and focus. */
export function Blocked({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function QuantityStepper({
  line,
  onQuantity,
}: {
  line: DraftLine;
  onQuantity: (quantity: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`One fewer ${line.partNumber}`}
        disabled={line.quantity <= 1}
        onClick={() => onQuantity(line.quantity - 1)}
      >
        <Minus aria-hidden />
      </Button>
      <Input
        aria-label={`Quantity of ${line.partNumber}`}
        inputMode="numeric"
        value={line.quantity}
        onChange={(event) => onQuantity(Number(event.target.value))}
        className="h-6 w-9 rounded-none border-0 bg-transparent px-0 text-center tabular shadow-none focus-visible:ring-0 md:text-[0.8rem] dark:bg-transparent"
      />
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`One more ${line.partNumber}`}
        disabled={line.quantity >= MAX_QUANTITY}
        onClick={() => onQuantity(line.quantity + 1)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

/** The quote's lines with their quantities, unit prices and line totals. */
export function LinesCard({
  lines,
  onLines,
  addParts,
}: {
  lines: readonly DraftLine[];
  /** Absent when the quote no longer takes changes. */
  onLines: ((lines: DraftLine[]) => void) | undefined;
  addParts: Record<string, string> | undefined;
}) {
  const setQuantity = (partNumber: string, quantity: number) =>
    onLines?.(
      lines.map((line) =>
        line.partNumber === partNumber ? { ...line, quantity: clampQuantity(quantity) } : line,
      ),
    );
  return (
    <Card size="sm" className="gap-0 py-0">
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <h2 className="text-sm font-medium">Lines</h2>
        <span className="text-xs text-muted-foreground tabular">{lines.length}</span>
        {addParts && (
          <Button asChild size="xs" variant="outline" className="ml-auto">
            <Link to="/parts" search={addParts}>
              <Plus aria-hidden />
              Add parts
            </Link>
          </Button>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          No lines yet. Add parts from the lookup.
        </p>
      ) : (
        <Table className="text-[0.8rem]">
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="h-8 pl-3">Part number</TableHead>
              <TableHead className="h-8 w-full">Description</TableHead>
              <TableHead className="h-8 text-center">Quantity</TableHead>
              <TableHead className="h-8 text-right">Unit</TableHead>
              <TableHead className="h-8 text-right">Line total</TableHead>
              <TableHead className="h-8 w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.partNumber}>
                <TableCell className="py-1.5 pl-3 font-mono font-medium">
                  {line.partNumber}
                </TableCell>
                <TableCell className="max-w-0 truncate py-1.5" title={line.description}>
                  {line.description}
                </TableCell>
                <TableCell className="py-1.5 text-center">
                  {onLines ? (
                    <QuantityStepper
                      line={line}
                      onQuantity={(quantity) => setQuantity(line.partNumber, quantity)}
                    />
                  ) : (
                    <span className="tabular">{line.quantity}</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular">{euro(line.unitPrice)}</TableCell>
                <TableCell className="py-1.5 text-right font-medium tabular">
                  {euro(line.unitPrice * line.quantity)}
                </TableCell>
                <TableCell className="py-1.5 pr-2">
                  {onLines && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${line.partNumber}`}
                      onClick={() =>
                        onLines(lines.filter((other) => other.partNumber !== line.partNumber))
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="py-1.5 text-right text-muted-foreground">
                Sum of lines
              </TableCell>
              <TableCell className="py-1.5 text-right tabular">{euro(totalOf(lines, 0))}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </Card>
  );
}

/**
 * The discount in whole percent with its reason. The track marks the desk's 10 percent limit;
 * above it the field turns to the warning color and says a supervisor must approve. The policy
 * decides inside the transaction, so the field only warns.
 */
function DiscountField({
  percent,
  reason,
  onChange,
}: {
  percent: number;
  reason: string;
  /** Absent when the quote no longer takes changes. */
  onChange: ((change: { percent?: number; reason?: string }) => void) | undefined;
}) {
  const id = useId();
  const over = percent > DESK_DISCOUNT_LIMIT;
  const setPercent = (value: number) =>
    onChange?.({ percent: Math.min(MAX_DISCOUNT, Math.max(0, Math.round(value) || 0)) });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-percent`}>Discount</Label>
        <div className="flex items-center gap-1">
          <Input
            id={`${id}-percent`}
            type="number"
            min={0}
            max={MAX_DISCOUNT}
            step={1}
            value={percent}
            disabled={!onChange}
            aria-describedby={`${id}-limit`}
            onChange={(event) => setPercent(Number(event.target.value))}
            className={cn(
              'h-7 w-16 text-right tabular',
              over &&
                'border-warning text-warning focus-visible:border-warning focus-visible:ring-warning/30',
            )}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>
      {/* The thumb's centre moves over the track less half a thumb at each end, so the 10 percent
          mark sits a third of the way along that shorter span. */}
      <div className="relative pb-4">
        <input
          type="range"
          aria-hidden
          tabIndex={-1}
          min={0}
          max={MAX_DISCOUNT}
          step={1}
          value={percent}
          disabled={!onChange}
          onChange={(event) => setPercent(Number(event.target.value))}
          className={cn('block w-full', over ? 'accent-warning' : 'accent-primary')}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-[calc((100%_-_1rem)/3_+_0.5rem)] h-4 w-0.5 -translate-x-1/2 rounded-full bg-warning"
        />
        <span
          aria-hidden
          className="absolute bottom-0 left-0 text-[0.65rem] text-muted-foreground tabular"
        >
          0
        </span>
        <span
          aria-hidden
          className="absolute bottom-0 left-[calc((100%_-_1rem)/3_+_0.5rem)] -translate-x-1/2 text-[0.65rem] font-medium text-warning tabular"
        >
          {DESK_DISCOUNT_LIMIT}
        </span>
        <span
          aria-hidden
          className="absolute right-0 bottom-0 text-[0.65rem] text-muted-foreground tabular"
        >
          {MAX_DISCOUNT}
        </span>
      </div>
      <p
        id={`${id}-limit`}
        className={cn('text-xs', over ? 'font-medium text-warning' : 'text-muted-foreground')}
      >
        {over
          ? `Above ${DESK_DISCOUNT_LIMIT} percent a supervisor must approve.`
          : `The desk gives up to ${DESK_DISCOUNT_LIMIT} percent.`}
      </p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-reason`}>Reason</Label>
        <Input
          id={`${id}-reason`}
          placeholder="Framework agreement 2026"
          value={reason}
          disabled={!onChange}
          onChange={(event) => onChange?.({ reason: event.target.value })}
        />
      </div>
    </div>
  );
}

function Totals({ lines, percent }: { lines: readonly DraftLine[]; percent: number }) {
  const gross = totalOf(lines, 0);
  const total = totalOf(lines, percent);
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Sum of lines</dt>
        <dd className="tabular">{euro(gross)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Discount {percent} %</dt>
        <dd className="tabular">{percent ? `− ${euro(gross - total)}` : euro(0)}</dd>
      </div>
      <div className="flex items-baseline justify-between border-t pt-2">
        <dt className="font-medium">Total</dt>
        <dd className="text-base font-semibold tabular">{euro(total)}</dd>
      </div>
    </dl>
  );
}

function InquiryLine({ inquiryId }: { inquiryId: string }) {
  const inquiry = useQuery(live.liveQueryOptions(operations.inquiryGet, { id: inquiryId })).data;
  if (!inquiry) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="line-clamp-2">
      {inquiry.subject} <span className="text-muted-foreground">({inquiry.caller})</span>
    </span>
  );
}

function TransformerModel({ serial }: { serial: string }) {
  const found = useQuery(live.liveQueryOptions(operations.transformerFind, { serial })).data;
  const model = found?.items.find((item) => item.serial === serial)?.model;
  return model ? <span className="ml-1.5 text-xs text-muted-foreground">{model}</span> : null;
}

/** The right-hand summary: who and what the quote is for, its discount, total and commands. */
export function SummaryCard({
  draft,
  onChange,
  facts,
  notice,
  errors,
  children,
}: {
  draft: QuoteDraft;
  onChange: ((change: Partial<QuoteDraft>) => void) | undefined;
  facts?: ReactNode;
  notice?: string;
  errors: readonly (string | undefined)[];
  children: ReactNode;
}) {
  const shown = errors.filter((error): error is string => Boolean(error));
  return (
    <Card size="sm" className="gap-3 pb-0">
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Utility</dt>
          <dd className="min-w-0">
            <UtilityName customerId={draft.customerId} />
          </dd>
          <dt className="text-muted-foreground">Transformer</dt>
          <dd>
            <Link
              to={`/transformers/${draft.serial}`}
              className="font-mono text-primary underline-offset-4 hover:underline"
            >
              {draft.serial}
            </Link>
            <TransformerModel serial={draft.serial} />
          </dd>
          {draft.inquiryId && (
            <>
              <dt className="text-muted-foreground">Inquiry</dt>
              <dd className="min-w-0">
                <InquiryLine inquiryId={draft.inquiryId} />
              </dd>
            </>
          )}
          {facts}
        </dl>
        <Separator />
        <DiscountField percent={draft.percent} reason={draft.reason} onChange={onChange} />
        <Separator />
        <Totals lines={draft.lines} percent={draft.percent} />
        {notice && (
          <p role="status" className="text-xs text-warning">
            {notice}
          </p>
        )}
        {shown.map((error) => (
          <p key={error} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ))}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">{children}</CardFooter>
    </Card>
  );
}
