import { Button } from '@/components/ui/button';
import { format, type Characteristic, type Target } from './format';

/** What is being measured, which sample, its target, and the way back to worklist order. */
export function CaptureHeading({
  characteristic,
  target,
  overridden,
  onDiscard,
}: {
  characteristic: Characteristic;
  target: Target;
  overridden: boolean;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold tracking-widest text-primary">
          NOW MEASURING · SAMPLE {target.sample} OF {characteristic.sampleSize}
        </p>
        <h2 className="mt-1.5 text-[2rem] leading-tight font-semibold tracking-tight">
          {characteristic.text}{' '}
          <span className="font-mono text-lg font-medium text-muted-foreground">
            {characteristic.code}
          </span>
        </h2>
        {overridden && (
          <Button variant="link" className="h-auto px-0" onClick={onDiscard}>
            Back to worklist order
          </Button>
        )}
      </div>
      {characteristic.target !== undefined && (
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Target</div>
          <div className="font-mono text-2xl font-semibold">
            {format(characteristic.target, characteristic.decimals)}{' '}
            <span className="text-base font-normal text-muted-foreground">
              {characteristic.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Another caller recorded the draft's sample first: the draft is not silently moved elsewhere. */
export function TakenAlert({
  characteristic,
  target,
  taken,
  onDiscard,
}: {
  characteristic: Characteristic;
  target: Target;
  taken: Characteristic['results'][number];
  onDiscard: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      <span>
        Sample {target.sample} was recorded elsewhere as{' '}
        <strong className="tabular">
          {taken.value !== undefined ? format(taken.value, characteristic.decimals) : taken.code}
        </strong>
        . Your entry was not saved.
      </span>
      <Button variant="outline" size="sm" onClick={onDiscard}>
        Discard my entry
      </Button>
    </div>
  );
}
