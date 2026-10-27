import { SyncMarker } from '../sync-status';
import { cn } from '@/lib/utils';
import { format, spec, type Characteristic, type Target } from './format';

/** One characteristic in the rail: recorded samples with their sync state, open ones to pick. */
export function CharacteristicSamples({
  characteristic,
  target,
  onSelect,
}: {
  characteristic: Characteristic;
  target: Target;
  onSelect: (sample: number) => void;
}) {
  const bySample = new Map(characteristic.results.map((result) => [result.sample, result]));
  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-4 py-3.5',
        target.characteristicId === characteristic.id && 'border-2 border-primary',
      )}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{characteristic.text}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {characteristic.code}
          {spec(characteristic)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: characteristic.sampleSize }, (_, index) => index + 1).map(
          (sample) => {
            const result = bySample.get(sample);
            const current =
              target.characteristicId === characteristic.id && target.sample === sample;
            return result ? (
              <div
                key={sample}
                title={`Sample ${sample}`}
                className={cn(
                  'flex min-w-18 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs',
                  result.evaluation === 'accepted'
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="font-mono text-[0.8rem] font-semibold">
                  {result.value !== undefined
                    ? format(result.value, characteristic.decimals)
                    : result.code}
                </span>
                <SyncMarker
                  sync={result.sync}
                  sorRef={result.sorRef}
                  rejection={result.rejection}
                />
              </div>
            ) : (
              <button
                key={sample}
                type="button"
                aria-label={`Measure ${characteristic.code} sample ${sample}`}
                aria-current={current ? 'step' : undefined}
                onClick={() => onSelect(sample)}
                className={cn(
                  'flex min-h-11 min-w-18 items-center justify-center rounded-lg border border-dashed font-mono text-[0.8rem] text-muted-foreground hover:bg-muted',
                  current &&
                    'border-2 border-solid border-primary bg-primary/10 font-semibold text-primary',
                )}
              >
                {sample}
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}
