import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { MAX_PAGE } from '@agent-native/contracts';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';
import { totalOf } from '../contracts/quote';
import type { Part } from '../contracts/part';
import { LeadTime, Pager, QuotesTable, StockBadge } from './common';
import { assemblyLabel, assemblyOrder, euro } from './format';
import { AssemblyOutline } from './outline';
import { newQuoteKey, useQuoteDraft } from './quote-drafts';
import { useInquiry, useScreenRecords } from './screen-context';
import { inquiryRecord, transformerRecord } from './screen-records';
import type { FoundTransformer } from './serial';

const QUOTES_PAGE = 25;

/**
 * Where each assembly's card sits in the exploded view, around the tank: the bushings and the
 * conservator above the cover, the cover across, the tap changer and the protection relays on
 * either side of the tank. The view takes three columns once the screen, which the assistant
 * panel narrows, is 48rem wide.
 */
const placement: Record<Part['assembly'], string> = {
  'hv-bushings': '@3xl/main:col-start-1 @3xl/main:row-start-1',
  conservator: '@3xl/main:col-start-2 @3xl/main:row-start-1',
  'lv-bushings': '@3xl/main:col-start-3 @3xl/main:row-start-1',
  'tank-cover': '@3xl/main:col-span-3 @3xl/main:row-start-2',
  'tap-changer': '@3xl/main:col-start-1 @3xl/main:row-start-3',
  protection: '@3xl/main:col-start-3 @3xl/main:row-start-3',
};

/** The call the desk opened the transformer from, when it came from the Inquiries screen. */
function CallLine({ inquiryId }: { inquiryId: string }) {
  const query = useQuery(live.liveQueryOptions(operations.inquiryGet, { id: inquiryId }));
  if (!query.data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Call from {query.data.caller}: {query.data.subject}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium whitespace-nowrap tabular">{children}</dd>
    </div>
  );
}

function HeaderBand({
  transformer,
  inquiryId,
}: {
  transformer: FoundTransformer;
  inquiryId: string | undefined;
}) {
  const customer = useQuery(
    live.liveQueryOptions(operations.customerGet, { id: transformer.customerId }),
  ).data;
  const context = { serial: transformer.serial, ...(inquiryId ? { inquiry: inquiryId } : {}) };
  return (
    <header className="space-y-2.5 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-mono text-lg leading-tight font-semibold">{transformer.serial}</h1>
        <p className="min-w-0 truncate">
          {transformer.customerName}
          {customer && (
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
              {customer.account} · {customer.phone}
            </span>
          )}
        </p>
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/parts" search={context}>
              Find parts
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/quotes/new" search={context}>
              New quote
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`/transformers/edit/${transformer.id}`}>Edit</Link>
          </Button>
        </div>
      </div>
      <Separator />
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Fact label="Model">{transformer.model}</Fact>
        <Fact label="Rating">{transformer.ratingMva} MVA</Fact>
        <Fact label="Voltage">{transformer.voltage}</Fact>
        <Fact label="Substation">{transformer.substation}</Fact>
        <Fact label="In service since">{transformer.yearInService}</Fact>
        <Fact label="Tap changer">{transformer.tapChanger}</Fact>
      </dl>
      {inquiryId && <CallLine inquiryId={inquiryId} />}
    </header>
  );
}

function AssemblyCard({ assembly, parts }: { assembly: Part['assembly']; parts: readonly Part[] }) {
  return (
    <Card
      size="sm"
      role="region"
      aria-label={assemblyLabel[assembly]}
      className={cn('gap-1.5', placement[assembly])}
    >
      <CardHeader className="flex items-center gap-2">
        <AssemblyOutline assembly={assembly} className="size-7" />
        <CardTitle>{assemblyLabel[assembly]}</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground tabular">
          {parts.length} {parts.length === 1 ? 'part' : 'parts'}
        </span>
      </CardHeader>
      <CardContent>
        {parts.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">No spare part fits this assembly.</p>
        ) : (
          <ul
            className={cn(
              'divide-y divide-border',
              assembly === 'tank-cover' &&
                '@3xl/main:grid @3xl/main:grid-cols-3 @3xl/main:gap-x-6 @3xl/main:divide-y-0',
            )}
          >
            {parts.map((part) => (
              <li key={part.id} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-medium">{part.partNumber}</div>
                  <div className="truncate text-xs text-muted-foreground">{part.description}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <StockBadge stock={part.stock} />
                  <LeadTime days={part.leadTimeDays} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The tank in the middle of the exploded view, with its cooling radiators. */
function Tank({ model }: { model: string }) {
  return (
    <div
      aria-hidden
      className="hidden flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3 @3xl/main:col-start-2 @3xl/main:row-start-3 @3xl/main:flex"
    >
      <svg
        viewBox="0 0 120 80"
        fill="none"
        strokeWidth={1.25}
        className="h-24 w-full max-w-56 stroke-muted-foreground"
      >
        <rect x="24" y="8" width="72" height="64" rx="2" />
        <path d="M20 8h80" strokeWidth={2} />
        {[6, 10, 14, 18].map((x) => (
          <path key={x} d={`M${x} 18v44M${x + 96} 18v44`} />
        ))}
        <path d="M4 18h20M4 62h20M96 18h20M96 62h20" />
      </svg>
      <span className="text-xs text-muted-foreground">{model} tank</span>
    </div>
  );
}

/** One card per assembly with the parts that fit this transformer's model, around the tank. */
function ExplodedView({ transformer }: { transformer: FoundTransformer }) {
  const query = useQuery(
    live.liveQueryOptions(operations.partSearch, {
      transformerSerial: transformer.serial,
      limit: MAX_PAGE,
    }),
  );
  const items = query.data?.items ?? [];
  return (
    <section aria-label="Exploded view" className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">Assemblies</h2>
        {query.data && (
          <span className="text-xs text-muted-foreground tabular">
            {query.data.total} parts fit {transformer.model}
            {query.data.total > items.length && `, ${items.length} shown`}
          </span>
        )}
      </div>
      {query.isError ? (
        <p className="text-sm text-destructive">The parts could not be read.</p>
      ) : (
        <div className="grid gap-3 @lg/main:grid-cols-2 @3xl/main:grid-cols-3">
          {assemblyOrder.map((assembly) => (
            <AssemblyCard
              key={assembly}
              assembly={assembly}
              parts={items.filter((part) => part.assembly === assembly)}
            />
          ))}
          <Tank model={transformer.model} />
        </div>
      )}
    </section>
  );
}

/** The transformer's stored quotes, and the one the desk is writing for it, if any. */
function TransformerQuotes({ transformer }: { transformer: FoundTransformer }) {
  const [offset, setOffset] = useState(0);
  const unsaved = useQuoteDraft(newQuoteKey(transformer.serial));
  const query = useQuery(
    live.liveQueryOptions(operations.quoteList, {
      customerId: transformer.customerId,
      search: transformer.serial,
      offset,
      limit: QUOTES_PAGE,
    }),
  );
  return (
    <section aria-label="Quotes" className="space-y-2">
      <h2 className="text-sm font-medium">Quotes</h2>
      <Card size="sm" className="gap-2 py-1">
        {unsaved && unsaved.lines.length > 0 && (
          <div className="flex items-center gap-3 border-b px-3 py-2 text-[0.8rem]">
            <span className="font-medium">Unsaved quote</span>
            <span className="text-muted-foreground tabular">
              {unsaved.lines.length} {unsaved.lines.length === 1 ? 'line' : 'lines'} ·{' '}
              {euro(totalOf(unsaved.lines, unsaved.percent))}
            </span>
            <Button asChild size="xs" variant="outline" className="ml-auto">
              <Link to="/quotes/new" search={{ serial: transformer.serial }}>
                Open
              </Link>
            </Button>
          </div>
        )}
        <div className="px-1">
          <QuotesTable
            quotes={query.data?.items ?? []}
            utility={false}
            empty={query.isPending ? 'Loading quotes…' : 'No quotes for this transformer.'}
          />
        </div>
        {query.data && (
          <Pager
            offset={offset}
            limit={QUOTES_PAGE}
            total={query.data.total}
            onOffset={setOffset}
          />
        )}
      </Card>
    </section>
  );
}

/**
 * One transformer, opened by its serial: what the rating plate says, the parts that fit each
 * assembly, and its quotes. `transformer.find` reads it, so the serial in the address is the one
 * the caller reads out; an `inquiry` search parameter carries the call into the quote. The
 * assistant panel sees the transformer and the call.
 */
function TransformerScreen() {
  const params = useParams({ strict: false }) as { serial?: string };
  const search = useSearch({ strict: false }) as { inquiry?: unknown };
  const serial = (params.serial ?? '').toUpperCase();
  const inquiryId = search.inquiry === undefined ? undefined : String(search.inquiry);
  const query = useQuery({
    ...live.liveQueryOptions(operations.transformerFind, { serial: serial || 'TR-' }),
    enabled: serial !== '',
  });
  const transformer = query.data?.items.find((item) => item.serial === serial);
  const inquiry = useInquiry(inquiryId);
  useScreenRecords(
    transformer
      ? [transformerRecord(transformer), ...(inquiry ? [inquiryRecord(inquiry)] : [])]
      : [],
  );
  if (query.isPending && serial)
    return <p className="text-sm text-muted-foreground">Loading {serial}…</p>;
  if (!transformer)
    return <p className="text-sm text-muted-foreground">Transformer {serial} unavailable.</p>;
  return (
    <div className="space-y-4">
      <HeaderBand transformer={transformer} inquiryId={inquiryId} />
      <ExplodedView transformer={transformer} />
      <TransformerQuotes transformer={transformer} />
    </div>
  );
}

/** The default edit screen of one transformer; the assistant panel sees the transformer. */
function TransformerRecord() {
  const params = useParams({ strict: false }) as { id?: string };
  const transformer = useQuery(
    live.liveQueryOptions(operations.transformerGet, { id: params.id ?? '' }),
  ).data;
  const customer = useQuery({
    ...live.liveQueryOptions(operations.customerGet, { id: transformer?.customerId ?? '' }),
    enabled: transformer !== undefined,
  }).data;
  useScreenRecords(
    transformer ? [transformerRecord({ ...transformer, customerName: customer?.name })] : [],
  );
  return (
    <RecordScreen
      title="Transformer"
      get={operations.transformerGet}
      update={operations.transformerUpdate}
    />
  );
}

/**
 * The transformer register keeps the default list and edit screens for the people who keep
 * master data; a row opens the transformer by its serial.
 */
export const transformerRoutes = [
  {
    path: 'transformers',
    component: () => (
      <CollectionScreen
        title="Transformers"
        list={operations.transformerList}
        create={operations.transformerCreate}
        open={(row) => `/transformers/${String(row.serial)}`}
      />
    ),
  },
  { path: 'transformers/$serial', component: () => <TransformerScreen /> },
  { path: 'transformers/edit/$id', component: () => <TransformerRecord /> },
];
