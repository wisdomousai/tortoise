import { OctagonAlert } from 'lucide-react';
import { Freshness, SignalBanner } from '@/components/status-strip';
import { FRESH_MS, machineSignal, reading, shown, since, type Station } from './format';
import { OrderLine, RecipeLine } from './order-lines';

/** Machine state large enough to read from the machine, then the alarm or the order. */
export function MachineBanner({ station }: { station: Station }) {
  const machine = reading(station, 'machine');
  const alarm = reading(station, 'alarm');
  const { bridge, currentStop: stop, order } = station;
  return (
    <section aria-label="Machine" className="flex flex-wrap gap-(--operator-gap)">
      <SignalBanner
        className="flex-[1_1_22rem]"
        signal={bridge.stale ? 'idle' : machineSignal(machine?.value)}
        label={bridge.stale ? 'Not seen' : shown(machine)}
        detail={
          <>
            {stop && !stop.endedAt && !bridge.stale && <>for {since(stop.startedAt)} · </>}
            seen{' '}
            <Freshness
              observedAt={machine?.observedAt}
              staleAfterMs={FRESH_MS}
              confidence={machine?.confidence}
            />
          </>
        }
      />
      <div className="flex min-w-0 flex-[2_1_30rem] items-center gap-4 rounded-2xl bg-card px-6 py-5">
        {alarm?.value ? (
          <>
            <span className="flex size-14 flex-none items-center justify-center rounded-xl bg-op-fault/15 text-op-fault">
              <OctagonAlert className="size-8" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-muted-foreground">Alarm on the station screen</div>
              <div className="text-(length:--operator-text-lg) font-semibold">
                {String(alarm.value)}
              </div>
              <OrderLine station={station} />
              <RecipeLine station={station} />
            </div>
          </>
        ) : (
          <div className="min-w-0 space-y-1">
            <div className="text-muted-foreground">Order</div>
            {order ? (
              <div className="flex flex-wrap items-baseline gap-x-4">
                <span className="font-mono text-(length:--operator-text-lg) font-semibold">
                  {order.id}
                </span>
                <span>{order.materialText}</span>
              </div>
            ) : (
              <div className="text-(length:--operator-text-lg) font-semibold">No active order</div>
            )}
            <RecipeLine station={station} />
          </div>
        )}
      </div>
    </section>
  );
}
