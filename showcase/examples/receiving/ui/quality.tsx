import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { live } from '@/lib/session';
import { operations } from '../contracts';

/** Incoming inspection in quality inspection: where the announced arrivals stand. */
function InspectionStatus() {
  const status = useQuery(live.liveQueryOptions(operations.qualityStatus, {}));
  const rows: [string, string][] = [
    ['Waiting to be announced', String(status.data?.pending ?? 0)],
    ['Refused by quality inspection', String(status.data?.rejected ?? 0)],
    ['Being inspected', String(status.data?.inspecting ?? 0)],
    ['Passed', String(status.data?.passed ?? 0)],
    ['Failed', String(status.data?.failed ?? 0)],
    [
      'Last outcome import',
      status.data?.lastSyncAt ? new Date(status.data.lastSyncAt).toLocaleString() : 'Never',
    ],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inspection lots in quality inspection, searched live with your person's plant roles there. */
function LotSearch() {
  const [text, setText] = useState('');
  const term = text.trim();
  const search = useInfiniteQuery({
    ...live.remoteInfiniteQueryOptions(operations.qualityLotSearch, { q: term }),
    enabled: term.length > 0,
  });
  const source = search.data?.at(-1)?.source;
  const lots = search.data?.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="Inspection lots" className="space-y-3">
      <h2 className="text-base font-medium">Inspection lots</h2>
      <Input
        aria-label="Search inspection lots"
        placeholder="Lot, material or batch"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {search.error && (
        <p role="alert" className="text-sm text-destructive">
          {search.error.message}
        </p>
      )}
      {source?.status === 'unavailable' && (
        <p role="alert" className="text-sm text-destructive">
          {source.message ?? 'Quality inspection did not answer.'}
        </p>
      )}
      {source?.status === 'ok' && !lots.length && (
        <p className="text-sm text-muted-foreground">No lot at your plants matches.</p>
      )}
      <ul className="divide-y text-sm">
        {lots.map((lot) => (
          <li key={lot.externalId} className="flex gap-4 py-2">
            <span className="font-medium tabular-nums">{lot.externalId}</span>
            <span>{lot.materialText}</span>
            <span className="text-muted-foreground">
              {lot.plant} · {lot.quantity} {lot.unit} · {lot.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Quality inspection as a peer: incoming inspection status and the lot search. */
export function QualityScreen() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Quality inspection</h1>
      <InspectionStatus />
      <LotSearch />
    </div>
  );
}
