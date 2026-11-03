import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { totalOf } from '../contracts/quote';
import { useScreenCommand } from './command';
import { Pager, QuotesTable, StatusBadge, UtilityName } from './common';
import { euro, toneClass, when } from './format';
import { Blocked, LinesCard, SummaryCard } from './quote-builder';
import {
  discountChanged,
  fromQuote,
  linesChanged,
  linesInput,
  setQuoteDraft,
  useQuoteDraft,
  useQuoteDrafts,
  type QuoteDraft,
} from './quote-drafts';
import { NewQuote } from './quote-new';
import { useScreenRecords } from './screen-context';
import { quoteRecord } from './screen-records';

const PAGE = 50;

/**
 * A stored quote. A draft takes changes to its lines and discount, kept in this tab until Save
 * draft runs `quote.update` and `quote.discount` for what changed; Submit runs `quote.submit` on
 * a saved draft. A draft or submitted quote can be cancelled with a reason. The assistant panel
 * sees the quote, with the discount of its unsaved changes.
 */
function StoredQuote() {
  const params = useParams({ strict: false }) as { id?: string };
  const id = params.id ?? '';
  const query = useQuery(live.liveQueryOptions(operations.quoteGet, { id }));
  const pending = useQuoteDraft(id);
  const update = useScreenCommand(operations.quoteUpdate);
  const discount = useScreenCommand(operations.quoteDiscount);
  const submit = useScreenCommand(operations.quoteSubmit);
  const cancel = useScreenCommand(operations.quoteCancel);
  const [problem, setProblem] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const quote = query.data;
  useScreenRecords(quote ? [quoteRecord(quote, pending)] : []);
  if (query.isError) return <p className="text-sm text-muted-foreground">Quote unavailable.</p>;
  if (!quote) return <p className="text-sm text-muted-foreground">Loading the quote…</p>;

  const editable = quote.status === 'draft';
  const draft = editable && pending ? pending : fromQuote(quote);
  const newLines = editable && linesChanged(draft, quote);
  const newDiscount = editable && discountChanged(draft, quote);
  const dirty = newLines || newDiscount;
  const change = (next: Partial<QuoteDraft>) => {
    const changed = { ...draft, ...next };
    setQuoteDraft(
      id,
      linesChanged(changed, quote) || discountChanged(changed, quote) ? changed : undefined,
    );
  };
  const busy = update.pending || discount.pending || submit.pending || cancel.pending;

  const save = async () => {
    setProblem(undefined);
    const reason = draft.reason.trim();
    if (newDiscount && !reason) return setProblem('Give the reason for the discount.');
    if (newLines && 'error' in (await update.run({ id, lines: linesInput(draft.lines) }))) return;
    if (newDiscount && 'error' in (await discount.run({ id, percent: draft.percent, reason })))
      return;
    setQuoteDraft(id, undefined);
  };
  const confirmCancel = async () => {
    const result = await cancel.run({ id, reason: cancelReason.trim() });
    if ('error' in result) return;
    setQuoteDraft(id, undefined);
    setCancelling(false);
    setCancelReason('');
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">
          Quote <span className="font-mono">{quote.number}</span>
        </h1>
        <StatusBadge status={quote.status} />
        {dirty && (
          <Badge variant="outline" className={toneClass.warning}>
            Unsaved changes
          </Badge>
        )}
        <span className="text-xs text-muted-foreground tabular">
          Created {when(quote.createdAt)} by {quote.createdBy}
        </span>
      </header>
      <div className="grid items-start gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_21rem]">
        <LinesCard
          lines={draft.lines}
          onLines={editable ? (lines) => change({ lines }) : undefined}
          addParts={editable ? { serial: quote.transformerSerial, quote: quote.id } : undefined}
        />
        <SummaryCard
          draft={draft}
          onChange={editable ? change : undefined}
          {...(pending?.notice ? { notice: pending.notice } : {})}
          facts={
            quote.status === 'cancelled' && quote.cancelReason ? (
              <>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd>{quote.cancelReason}</dd>
              </>
            ) : undefined
          }
          errors={[problem, update.error, discount.error, submit.error, cancel.error]}
        >
          {editable && (
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              Save draft
            </Button>
          )}
          {cancelling ? (
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason for cancelling</Label>
              <Input
                id="cancel-reason"
                placeholder="Utility ordered elsewhere"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="destructive"
                  disabled={!cancelReason.trim() || busy}
                  onClick={() => void confirmCancel()}
                >
                  Confirm cancel
                </Button>
                <Button variant="ghost" onClick={() => setCancelling(false)}>
                  Keep the quote
                </Button>
              </div>
            </div>
          ) : (
            quote.status !== 'cancelled' && (
              <div className="grid grid-cols-2 gap-2">
                {!editable ? (
                  <Button variant="outline" disabled>
                    Submitted
                  </Button>
                ) : dirty ? (
                  <Blocked reason="Save the draft first">
                    <Button variant="outline" className="w-full" disabled>
                      Submit
                    </Button>
                  </Blocked>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void submit.run({ id })}>
                    Submit
                  </Button>
                )}
                <Button variant="destructive" disabled={busy} onClick={() => setCancelling(true)}>
                  Cancel quote
                </Button>
              </div>
            )
          )}
        </SummaryCard>
      </div>
    </div>
  );
}

const statusTabs = ['all', 'draft', 'submitted', 'cancelled'] as const;
type StatusTab = (typeof statusTabs)[number];

/** The unsaved quotes of this tab, one per transformer. */
function UnsavedQuotes() {
  const drafts = Object.entries(useQuoteDrafts()).filter(
    ([key, draft]) => key.startsWith('new:') && draft.lines.length > 0,
  );
  if (drafts.length === 0) return null;
  return (
    <Card size="sm" className="gap-0 py-1">
      {drafts.map(([key, draft]) => (
        <div key={key} className="flex items-center gap-3 px-3 py-1.5 text-[0.8rem]">
          <span className="font-medium">Unsaved quote</span>
          <span className="font-mono">{draft.serial}</span>
          <span className="min-w-0 truncate">
            <UtilityName customerId={draft.customerId} account={false} />
          </span>
          <span className="text-muted-foreground tabular">
            {draft.lines.length} {draft.lines.length === 1 ? 'line' : 'lines'} ·{' '}
            {euro(totalOf(draft.lines, draft.percent))}
          </span>
          <Button asChild size="xs" variant="outline" className="ml-auto">
            <Link to="/quotes/new" search={{ serial: draft.serial }}>
              Open
            </Link>
          </Button>
        </div>
      ))}
    </Card>
  );
}

function QuotesScreen() {
  const [status, setStatus] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const words = search.trim();
  const list = useQuery(
    live.liveQueryOptions(operations.quoteList, {
      ...(status === 'all' ? {} : { status }),
      ...(words ? { search: words } : {}),
      offset,
      limit: PAGE,
    }),
  );
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Quotes</h1>
        <Tabs
          value={status}
          onValueChange={(value) => {
            setStatus(value as StatusTab);
            setOffset(0);
          }}
        >
          <TabsList>
            {statusTabs.map((value) => (
              <TabsTrigger key={value} value={value} className="px-2.5 capitalize">
                {value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          aria-label="Search quotes"
          placeholder="Number or serial"
          className="ml-auto h-8 w-64"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
      </header>
      <UnsavedQuotes />
      <Card size="sm" className="gap-2 py-1">
        <div className="px-1">
          <QuotesTable
            quotes={list.data?.items ?? []}
            empty={list.isPending ? 'Loading quotes…' : 'No quotes.'}
          />
        </div>
        {list.data && (
          <Pager offset={offset} limit={PAGE} total={list.data.total} onOffset={setOffset} />
        )}
      </Card>
    </div>
  );
}

/** The quotes list and the quote builder for a new quote and for a stored one. */
export const quoteRoutes = [
  { path: 'quotes', component: () => <QuotesScreen /> },
  { path: 'quotes/new', component: () => <NewQuote /> },
  { path: 'quotes/$id', component: () => <StoredQuote /> },
];
