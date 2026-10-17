import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/session';
import type { Characteristic, InstrumentReading } from './format';

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/**
 * The newest reading the station's instrument sent, offered for the current sample. Nothing is
 * shown until a reading arrives, so a station without an instrument looks as before. Using it is
 * the inspector's confirmation that the reading belongs to this sample.
 */
export function InstrumentReadingOffer({
  characteristic,
  disabled,
  error,
  onUse,
}: {
  characteristic: Characteristic;
  disabled: boolean;
  error: string;
  onUse: (reading: InstrumentReading) => void;
}) {
  const readings = useQuery(live.liveQueryOptions(operations.instrumentReadings, {}));
  const reading = readings.data?.readings[0];
  if (!reading) return null;
  const otherUnit = characteristic.unit !== undefined && characteristic.unit !== reading.unit;
  return (
    <section
      aria-label="Instrument reading"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/40 px-4 py-3"
    >
      <Gauge className="size-5 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xl font-medium tabular-nums">
          {reading.value} {reading.unit}
        </p>
        <p className="text-[0.8rem] text-muted-foreground">
          {reading.device.serial ? `Instrument ${reading.device.serial}` : 'Instrument'} ·{' '}
          {time(reading.observedAt)}
          {otherUnit ? ` · this characteristic is in ${characteristic.unit}` : ''}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || otherUnit}
        onClick={() => onUse(reading)}
      >
        Use reading
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
