import { useQuery } from '@tanstack/react-query';
import { DeliveryBadge } from '@/components/status-strip';
import { live } from '@/lib/session';
import { operations } from '../../contracts';

/** The last stops, collapsed under the task so they never push it off screen. */
export function RecentStops({ station }: { station: string }) {
  const stops = useQuery(live.liveQueryOptions(operations.stopList, { station, limit: 5 }));
  const items = stops.data?.items ?? [];
  const last = items[0];
  if (!last) return <span className="text-muted-foreground">No stops recorded</span>;
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-muted-foreground">
          Last stop{' '}
          {new Date(last.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
          · {last.reason ?? 'not classified'}
        </span>
        <span className="ml-auto rounded-lg bg-muted px-4 py-2 font-medium group-open:hidden">
          Recent stops ({items.length})
        </span>
        <span className="ml-auto hidden rounded-lg bg-muted px-4 py-2 font-medium group-open:inline">
          Hide stops
        </span>
      </summary>
      <section aria-label="Recent stops" className="mt-3">
        <ul className="divide-y rounded-xl border">
          {items.map((stop) => (
            <li key={stop.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="tabular">{new Date(stop.startedAt).toLocaleTimeString()}</span>
              <span>{stop.state}</span>
              {stop.alarm && <span className="text-muted-foreground">{stop.alarm}</span>}
              <span className="flex-1">{stop.reason ?? 'Not classified'}</span>
              {stop.sync && (
                <DeliveryBadge state={stop.sync} reference={stop.sorRef} reason={stop.rejection} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </details>
  );
}
