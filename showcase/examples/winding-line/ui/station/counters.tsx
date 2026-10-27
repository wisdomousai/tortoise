import { BigAction } from '@/components/big-action';
import { OperatorPanel } from '@/components/operator-station';
import { Freshness } from '@/components/status-strip';
import { client } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../../contracts';
import { FRESH_MS, reading, shown, type Reading, type Station } from './format';
import type { Run } from './use-station-commands';

const usable = (value: Reading | undefined) =>
  value !== undefined && value.value !== null && !value.stale;

/** One counter, marked when it is unsure or stale, with who checked it or how fresh it is. */
function CounterTile({ label, value }: { label: string; value: Reading | undefined }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-muted p-5',
        !usable(value) && 'bg-op-attention/15 ring-3 ring-op-attention ring-inset',
      )}
    >
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono text-[4.5rem] leading-none font-semibold tabular-nums">
        {shown(value)}
      </div>
      <div className="mt-1 text-[0.75em] text-muted-foreground">
        {value?.status === 'operator-verified' ? (
          <>Checked by {value.verifiedBy}</>
        ) : (
          <>
            read from the screen{' '}
            <Freshness
              observedAt={value?.observedAt}
              staleAfterMs={FRESH_MS}
              confidence={value?.confidence}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Good and scrap as read from the screen, and the hold to send them to the MES. */
export function Counters({
  station,
  person,
  pending,
  run,
}: {
  station: Station;
  person: boolean;
  pending: string | undefined;
  run: Run;
}) {
  const good = reading(station, 'good');
  const scrap = reading(station, 'scrap');
  const ready = usable(good) && usable(scrap);
  return (
    <OperatorPanel aria-label="Counters">
      <div className="grid gap-(--operator-gap) sm:grid-cols-2">
        {(
          [
            ['Good', good],
            ['Scrap', scrap],
          ] as const
        ).map(([label, value]) => (
          <CounterTile key={label} label={label} value={value} />
        ))}
      </div>
      {person && (
        <>
          <BigAction
            hold
            label="Hold to send counts to MES"
            disabled={!ready}
            pending={pending === 'counts'}
            onAction={() =>
              void run('counts', () =>
                client.command(
                  operations.countConfirm,
                  { station: station.id },
                  // The counters the operator looked at; changed counts conflict instead of sending.
                  { expectedRevisions: { [`counters:${station.id}`]: station.countersRevision } },
                ),
              )
            }
          />
          {!ready && (
            <p className="text-center text-muted-foreground">
              Sending is held until both numbers are sure and fresh.
            </p>
          )}
        </>
      )}
    </OperatorPanel>
  );
}
