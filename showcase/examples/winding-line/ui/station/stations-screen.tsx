import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { live } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../../contracts';
import { cardTone, machineWord, modeWord } from './format';

/** Stations where the signed-in person holds a role; each opens full window at the machine. */
export function StationsScreen() {
  const stations = useQuery(live.liveQueryOptions(operations.stationList, {}));
  const items = stations.data?.items ?? [];
  const count = (test: (station: (typeof items)[number]) => boolean) => items.filter(test).length;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Stations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read live from each station&apos;s own screen. Open one to run it full screen at the
            machine.
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {[
              [count((station) => !station.stale && station.machine !== 'RUNNING'), 'stopped'],
              [count((station) => !station.stale && station.machine === 'RUNNING'), 'running'],
              [count((station) => station.stale), 'not seen'],
            ]
              .filter(([value]) => value)
              .map(([value, word]) => `${value} ${word}`)
              .join(' · ')}
          </span>
        )}
      </header>
      {stations.error && <p role="alert">{stations.error.message}</p>}
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
        {items.map((station) => {
          const needsPerson = station.openStop || station.attention > 0;
          return (
            <Link
              key={station.id}
              to="/station/$stationId"
              params={{ stationId: station.id }}
              aria-label={`${station.name}, ${machineWord(station.machine, station.stale)}`}
              className={cn(
                'flex flex-col overflow-hidden rounded-2xl border bg-card hover:shadow-md',
                needsPerson && 'border-2 border-op-attention',
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-3 px-4.5 py-4 text-xl font-bold tracking-wide uppercase',
                  cardTone(station.machine, station.stale),
                )}
              >
                {machineWord(station.machine, station.stale)}
              </div>
              <div className="flex flex-col gap-2 px-4.5 py-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold">{station.name}</span>
                  <span className="text-sm text-muted-foreground">{station.line}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {station.openStop && <Chip tone="attention">Stop not classified</Chip>}
                  {station.attention > 0 && (
                    <Chip tone="attention">
                      {station.attention} {station.attention === 1 ? 'reading' : 'readings'} to
                      check
                    </Chip>
                  )}
                  <Chip>{modeWord[station.mode]}</Chip>
                  <Chip>{station.role}</Chip>
                </div>
              </div>
            </Link>
          );
        })}
        {stations.data && items.length === 0 && <p>You hold no station role.</p>}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone?: 'attention'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[0.8rem]',
        tone === 'attention' ? 'bg-op-attention/20 font-medium' : 'bg-muted',
      )}
    >
      {children}
    </span>
  );
}
