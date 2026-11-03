import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { MAX_PAGE } from '@agent-native/contracts';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { partCategories, type Part } from '../contracts/part';
import { totalOf } from '../contracts/quote';
import { LeadTime, StockBadge } from './common';
import { assemblyLabel, byAssembly, categoryLabel, euro } from './format';
import { AssemblyOutline, markOf } from './outline';
import {
  changeQuoteDraft,
  fromQuote,
  newQuoteKey,
  useQuoteDraft,
  withPart,
  type QuoteDraft,
} from './quote-drafts';
import { SerialMatches, serialText, type FoundTransformer } from './serial';
import { useInquiry, useScreenRecords, useScreenSelection } from './screen-context';
import { inquiryRecord, partRecord, quoteRecord, transformerRecord } from './screen-records';

type Category = (typeof partCategories)[number];
const text = (value: unknown) =>
  value === undefined || value === null || value === '' ? undefined : String(value);

/** `/` focuses the search field unless the person is typing in another field. */
function useSlashFocus(field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return;
      event.preventDefault();
      field.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [field]);
}

function PartCard({
  part,
  inQuote,
  onAdd,
  selected,
  onSelect,
}: {
  part: Part;
  inQuote: number;
  /** Absent while no transformer is chosen, since a quote is for one transformer. */
  onAdd: (() => void) | undefined;
  /** Whether the person selected the part, which the assistant panel then sees. */
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  return (
    <Card size="sm" role="article" aria-label={part.partNumber} className="flex-row gap-3 px-3">
      <input
        type="checkbox"
        aria-label={`Select ${part.partNumber}`}
        className="mt-1 size-4 shrink-0 self-start accent-primary"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
      />
      <div className="self-start rounded-lg bg-muted p-1.5">
        <AssemblyOutline assembly={part.assembly} mark={markOf(part)} className="size-14" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="font-mono text-sm font-medium">
                {part.partNumber}
              </span>
            </TooltipTrigger>
            <TooltipContent>Fits {part.fits.join(', ')}</TooltipContent>
          </Tooltip>
          <span className="text-sm font-medium whitespace-nowrap tabular">
            {euro(part.unitPrice)}
            <span className="font-normal text-muted-foreground"> / unit</span>
          </span>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{part.description}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2">
            <StockBadge stock={part.stock} />
            <LeadTime days={part.leadTimeDays} />
          </div>
          <div className="flex items-center gap-2">
            {inQuote > 0 && (
              <span className="text-xs text-primary tabular">{inQuote} in quote</span>
            )}
            {onAdd ? (
              <Button size="xs" variant="outline" onClick={onAdd}>
                <Plus aria-hidden />
                Add to quote
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button size="xs" variant="outline" disabled>
                      <Plus aria-hidden />
                      Add to quote
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Filter by a serial to quote for that transformer</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The serial filter: the chosen transformer, or a field that finds it from the first digits. */
function SerialFilter({
  serial,
  transformer,
  unknown,
  onSerial,
}: {
  serial: string | undefined;
  transformer: FoundTransformer | undefined;
  unknown: boolean;
  onSerial: (serial: string | undefined) => void;
}) {
  const [typed, setTyped] = useState('');
  if (serial)
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-8 items-center gap-2 rounded-lg border bg-card pr-1 pl-2.5 text-sm">
          <span className="text-xs text-muted-foreground">Fits</span>
          <span className="font-mono font-medium">{serial}</span>
          {transformer && (
            <span className="text-xs text-muted-foreground">
              {transformer.model} · {transformer.customerName}
            </span>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Clear the serial filter"
            onClick={() => onSerial(undefined)}
          >
            <X aria-hidden />
          </Button>
        </div>
        {unknown && <span className="text-xs text-warning">No transformer has this serial.</span>}
      </div>
    );
  return (
    <div className="relative w-60">
      <Input
        aria-label="Serial filter"
        className="h-8 font-mono"
        placeholder="Serial filter"
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && typed.trim()) onSerial(serialText(typed));
        }}
      />
      {typed.trim() && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 rounded-lg bg-card p-1.5 shadow-md ring-1 ring-foreground/10">
          <SerialMatches text={typed} onPick={(found) => onSerial(found.serial)} />
        </div>
      )}
    </div>
  );
}

/** What the desk has added for the transformer, and the way to the quote builder. */
function QuoteBar({
  draft,
  serial,
  quoteId,
}: {
  draft: QuoteDraft | undefined;
  serial: string;
  quoteId: string | undefined;
}) {
  const lines = draft?.lines.length ?? 0;
  return (
    <div className="ml-auto flex h-8 items-center gap-3 rounded-lg border bg-card pr-1 pl-3 text-sm">
      <span className="text-muted-foreground">
        {quoteId ? 'Changes to the quote' : 'New quote'}
      </span>
      <span className="tabular">
        {lines} {lines === 1 ? 'line' : 'lines'}
        {draft && lines > 0 && ` · ${euro(totalOf(draft.lines, draft.percent))}`}
      </span>
      <Button asChild size="xs">
        {quoteId ? (
          <Link to={`/quotes/${quoteId}`}>Open quote</Link>
        ) : (
          <Link to="/quotes/new" search={{ serial }}>
            Open quote
          </Link>
        )}
      </Button>
    </div>
  );
}

/**
 * The parts lookup: text, category and an optional serial narrow `part.search`, and the results
 * show as exploded-view cards by assembly. With a serial, Add to quote writes to the unsaved
 * quote for that transformer, or, with a `quote` search parameter, to unsaved changes of that
 * stored draft. An `inquiry` search parameter links the new quote to the call. The assistant
 * panel sees the transformer, the stored quote, the call and the parts the person selected, and
 * the assistant selects a part the results show.
 */
function PartsLookup() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const serial = text(search.serial)?.toUpperCase();
  const inquiryId = text(search.inquiry);
  const quoteId = text(search.quote);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | Category>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const searchField = useRef<HTMLInputElement>(null);
  useSlashFocus(searchField);

  const onSerial = (next: string | undefined) =>
    void navigate({
      to: '/parts',
      // Another transformer starts another quote, so the call and the stored quote stay behind.
      search: next ? { serial: next } : {},
      replace: true,
    });

  // part.search refuses an unknown serial, so the serial filter applies once transformer.find
  // knows the whole serial.
  const found = useQuery({
    ...live.liveQueryOptions(operations.transformerFind, { serial: serial ?? 'TR-' }),
    enabled: serial !== undefined,
  });
  const transformer = found.data?.items.find((item) => item.serial === serial);
  const stored = useQuery({
    ...live.liveQueryOptions(operations.quoteGet, { id: quoteId ?? '' }),
    enabled: quoteId !== undefined,
  }).data;
  const words = query.trim();
  const results = useQuery({
    ...live.liveQueryOptions(operations.partSearch, {
      ...(transformer ? { transformerSerial: transformer.serial } : {}),
      ...(category === 'all' ? {} : { category }),
      ...(words ? { text: words } : {}),
      limit: MAX_PAGE,
    }),
    enabled: serial === undefined || transformer !== undefined,
  });

  const draftKey = quoteId ?? (serial ? newQuoteKey(serial) : '');
  const draft = useQuoteDraft(draftKey);
  const canAdd = transformer !== undefined && (quoteId === undefined || stored !== undefined);
  const add = (part: Part) => {
    if (!transformer) return;
    const start = (): QuoteDraft =>
      quoteId && stored
        ? fromQuote(stored)
        : {
            serial: transformer.serial,
            customerId: transformer.customerId,
            ...(inquiryId ? { inquiryId } : {}),
            lines: [],
            percent: 0,
            reason: '',
          };
    changeQuoteDraft(draftKey, start, (current) =>
      withPart(
        !quoteId && inquiryId && !current.inquiryId ? { ...current, inquiryId } : current,
        part,
      ),
    );
  };
  const quantityOf = (part: Part) =>
    draft?.lines.find((line) => line.partNumber === part.partNumber)?.quantity ?? 0;

  const page = results.data;
  const inquiry = useInquiry(inquiryId);
  useScreenRecords([
    ...(transformer ? [transformerRecord(transformer)] : []),
    ...(stored ? [quoteRecord(stored, draft)] : []),
    ...(inquiry ? [inquiryRecord(inquiry)] : []),
    // Only the selected parts the results show now, so a narrower search drops the others.
    ...(page?.items.filter((part) => selected.has(part.id)).map(partRecord) ?? []),
  ]);
  const select = (part: Part, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(part.id);
      else next.delete(part.id);
      return next;
    });
  // The assistant selects a part the results show, as the person's checkbox does.
  useScreenSelection((kind, id) => {
    const part = page?.items.find((item) => item.id === id);
    if (kind !== 'part' || !part) return false;
    select(part, true);
    return true;
  });
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Parts</h1>
        <div className="relative w-72">
          <Input
            ref={searchField}
            aria-label="Search parts"
            placeholder="Part number or description"
            className="h-8 pr-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Kbd className="absolute top-1.5 right-1.5">/</Kbd>
        </div>
        <SerialFilter
          serial={serial}
          transformer={transformer}
          unknown={serial !== undefined && found.data !== undefined && !transformer}
          onSerial={onSerial}
        />
        {transformer && <QuoteBar draft={draft} serial={transformer.serial} quoteId={quoteId} />}
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={category} onValueChange={(value) => setCategory(value as 'all' | Category)}>
          <TabsList>
            <TabsTrigger value="all" className="px-2.5">
              All
            </TabsTrigger>
            {partCategories.map((value) => (
              <TabsTrigger key={value} value={value} className="px-2.5">
                {categoryLabel[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {page && (
          <span className="text-xs text-muted-foreground tabular">
            {page.total} {page.total === 1 ? 'part' : 'parts'}
            {transformer && ` fit ${transformer.serial}, a ${transformer.model}`}
            {page.total > page.items.length && `, the first ${page.items.length} shown`}
          </span>
        )}
      </div>
      {page && page.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No part matches.</p>
      )}
      {results.isError && <p className="text-sm text-destructive">The parts could not be read.</p>}
      {page &&
        byAssembly(page.items).map(({ assembly, parts }) => (
          <section key={assembly} aria-label={assemblyLabel[assembly]} className="space-y-1.5">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <AssemblyOutline assembly={assembly} className="size-5" />
              {assemblyLabel[assembly]}
              <span className="text-xs font-normal text-muted-foreground tabular">
                {parts.length}
              </span>
            </h2>
            <div className="grid gap-2 @3xl/main:grid-cols-2 @6xl/main:grid-cols-3">
              {parts.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  inQuote={quantityOf(part)}
                  onAdd={canAdd ? () => add(part) : undefined}
                  selected={selected.has(part.id)}
                  onSelect={(on) => select(part, on)}
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

/** The default record screen of one part; the assistant panel sees the part. */
function PartRecord() {
  const params = useParams({ strict: false }) as { id?: string };
  const part = useQuery(live.liveQueryOptions(operations.partGet, { id: params.id ?? '' })).data;
  useScreenRecords(part ? [partRecord(part)] : []);
  return <RecordScreen title="Part" get={operations.partGet} update={operations.partUpdate} />;
}

/**
 * The parts lookup, and the default catalog and record screens for the people who keep the
 * parts' stock and prices.
 */
export const partRoutes = [
  { path: 'parts', component: () => <PartsLookup /> },
  {
    path: 'parts/catalog',
    component: () => (
      <CollectionScreen
        title="Part catalog"
        list={operations.partList}
        create={operations.partCreate}
        open={(row) => `/parts/${String(row.id)}`}
      />
    ),
  },
  { path: 'parts/$id', component: () => <PartRecord /> },
];
