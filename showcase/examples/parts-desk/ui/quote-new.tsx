import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { MAX_PAGE } from '@agent-native/contracts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePreparedInput } from '@/lib/os-deliveries';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { useScreenCommand } from './command';
import { Blocked, LinesCard, SummaryCard } from './quote-builder';
import {
  changeQuoteDraft,
  draftFromPrepared,
  fromQuote,
  linesInput,
  newQuoteKey,
  preparedQuote,
  preparedQuoteKey,
  setQuoteDraft,
  useQuoteDraft,
  type QuoteDraft,
} from './quote-drafts';
import { useInquiry, useScreenRecords } from './screen-context';
import { inquiryRecord, transformerRecord } from './screen-records';

const text = (value: unknown) =>
  value === undefined || value === null || value === '' ? undefined : String(value);

/**
 * What the builder says about a form the assistant prepared, with Discard. Nothing is created
 * until the person clicks Create draft.
 */
function PreparedNotice({ left, onDiscard }: { left: readonly string[]; onDiscard: () => void }) {
  return (
    <Alert>
      <Sparkles aria-hidden />
      <AlertTitle role="status">The assistant prepared this quote</AlertTitle>
      <AlertDescription>
        Check the lines and the discount. Nothing is saved until you click Create draft.
        {left.length > 0 &&
          ` ${left.join(', ')} ${left.length === 1 ? 'does' : 'do'} not fit this transformer and ${left.length === 1 ? 'is' : 'are'} left out.`}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      </AlertAction>
    </Alert>
  );
}

/**
 * A new quote for one transformer, from the lines the lookup added or the form an assistant run
 * prepared (`usePreparedInput` of `quote.create`). Create draft runs `quote.create` and then, with
 * a discount, `quote.discount`. When the instance refuses the discount, such as above 10 percent
 * for the desk, the draft stays without it and the quote screen shows the refused discount as an
 * unsaved change with the reason it was refused. A prepared form for this transformer takes the
 * place of the desk's own unsaved quote until the person creates it or discards it; the person's
 * changes to it are kept apart, so Discard returns to the unsaved quote as it was. The assistant
 * panel sees the transformer and the call.
 */
export function NewQuote() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const serial = text(search.serial)?.toUpperCase() ?? '';
  const inquiryParam = text(search.inquiry);
  const key = newQuoteKey(serial);
  const saved = useQuoteDraft(key);
  const run = usePreparedInput(operations.quoteCreate.id);
  const offered = run.prepared ? preparedQuote(run.prepared.input) : undefined;
  const filled = run.prepared && offered?.serial === serial ? run.prepared : undefined;
  const changed = useQuoteDraft(preparedQuoteKey(serial));
  const found = useQuery({
    ...live.liveQueryOptions(operations.transformerFind, { serial: serial || 'TR-' }),
    enabled: serial !== '',
  });
  const transformer = found.data?.items.find((item) => item.serial === serial);
  // The prepared lines take their descriptions and prices from the parts that fit.
  const fitting = useQuery({
    ...live.liveQueryOptions(operations.partSearch, { transformerSerial: serial, limit: MAX_PAGE }),
    enabled: filled !== undefined && transformer !== undefined,
  });
  const create = useScreenCommand(operations.quoteCreate);
  const discount = useScreenCommand(operations.quoteDiscount);
  const [problem, setProblem] = useState<string>();
  const inquiry = useInquiry(filled ? offered?.inquiryId : (saved?.inquiryId ?? inquiryParam));
  useScreenRecords(
    transformer
      ? [transformerRecord(transformer), ...(inquiry ? [inquiryRecord(inquiry)] : [])]
      : [],
  );
  if (!serial)
    return (
      <p className="text-sm text-muted-foreground">
        Open a transformer or filter the parts by a serial to start a quote.
      </p>
    );
  if (found.isPending) return <p className="text-sm text-muted-foreground">Loading {serial}…</p>;
  if (!transformer)
    return <p className="text-sm text-muted-foreground">Transformer {serial} unavailable.</p>;
  if (filled && !fitting.data)
    return (
      <p className="text-sm text-muted-foreground">
        {fitting.isError ? 'The parts could not be read.' : 'Loading the prepared quote…'}
      </p>
    );

  const start = (): QuoteDraft => ({
    serial,
    customerId: transformer.customerId,
    ...(inquiryParam ? { inquiryId: inquiryParam } : {}),
    lines: [],
    percent: 0,
    reason: '',
  });
  const prepared =
    filled && offered && fitting.data
      ? draftFromPrepared(offered, start(), fitting.data.items, filled.id)
      : undefined;
  // The person's changes hold for the prefill they were made to; a newer prefill starts afresh.
  const draft = prepared
    ? changed && changed.preparedId === prepared.draft.preparedId
      ? changed
      : prepared.draft
    : (saved ?? start());
  const change = (next: Partial<QuoteDraft>) =>
    prepared
      ? setQuoteDraft(preparedQuoteKey(serial), { ...draft, ...next })
      : changeQuoteDraft(key, start, (current) => ({ ...current, ...next }));
  /** Drop the prepared form and the person's changes to it. */
  const discardPrepared = () => {
    run.dismiss();
    setQuoteDraft(preparedQuoteKey(serial), undefined);
  };
  const busy = create.pending || discount.pending;

  const createDraft = async () => {
    setProblem(undefined);
    const reason = draft.reason.trim();
    if (draft.percent > 0 && !reason) return setProblem('Give the reason for the discount.');
    const created = await create.run({
      customerId: draft.customerId,
      transformerSerial: serial,
      lines: linesInput(draft.lines),
      ...(draft.inquiryId ? { inquiryId: draft.inquiryId } : {}),
    });
    if ('error' in created) return;
    const quote = created.result;
    if (prepared) discardPrepared();
    else setQuoteDraft(key, undefined);
    if (draft.percent > 0) {
      const discounted = await discount.run({ id: quote.id, percent: draft.percent, reason });
      if ('error' in discounted)
        setQuoteDraft(quote.id, {
          ...fromQuote(quote),
          percent: draft.percent,
          reason,
          notice: `${quote.number} is a draft without the discount. ${discounted.error}`,
        });
    }
    void navigate({ to: `/quotes/${quote.id}` });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold">New quote</h1>
        <span className="text-sm text-muted-foreground">
          for <span className="font-mono">{serial}</span>, not saved yet
        </span>
      </header>
      {prepared && <PreparedNotice left={prepared.left} onDiscard={discardPrepared} />}
      <div className="grid items-start gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_21rem]">
        <LinesCard
          lines={draft.lines}
          onLines={(lines) => change({ lines })}
          // The lookup adds to the desk's own unsaved quote, so it waits for the prepared one.
          addParts={
            prepared
              ? undefined
              : { serial, ...(draft.inquiryId ? { inquiry: draft.inquiryId } : {}) }
          }
        />
        <SummaryCard
          draft={draft}
          onChange={change}
          errors={[problem, create.error, discount.error]}
        >
          <Button disabled={draft.lines.length === 0 || busy} onClick={() => void createDraft()}>
            Create draft
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Blocked reason="Create the draft first">
              <Button variant="outline" className="w-full" disabled>
                Submit
              </Button>
            </Blocked>
            <Blocked reason="Only a created quote can be cancelled">
              <Button variant="destructive" className="w-full" disabled>
                Cancel quote
              </Button>
            </Blocked>
          </div>
          {!prepared && draft.lines.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => setQuoteDraft(key, undefined)}>
              Discard the unsaved quote
            </Button>
          )}
        </SummaryCard>
      </div>
    </div>
  );
}
