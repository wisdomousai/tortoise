import type { Dispatch, RefObject, SetStateAction } from 'react';
import { ToleranceGauge } from '@/components/numeric-pad';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { parseEntry } from '@/lib/numeric-entry';
import type { Characteristic, Target } from './format';
import type { CaptureForm } from './use-capture';

/** Target and tolerance with the registry gauge of where the typed value falls. */
function Specification({
  characteristic,
  value,
}: {
  characteristic: Characteristic;
  value: string;
}) {
  const { lower, upper, target, unit, decimals } = characteristic;
  return (
    <div className="space-y-2">
      <ToleranceGauge
        value={parseEntry(value.trim())}
        tolerance={{ lower, upper, target }}
        unit={unit}
        decimals={decimals}
      />
    </div>
  );
}

/** The measured value: typing pins the slot, Escape clears it, Enter records. */
export function ValueEntry({
  form,
  characteristic,
  target,
  taken,
  valueField,
  setPinned,
}: {
  form: CaptureForm;
  characteristic: Characteristic;
  target: Target;
  taken: boolean;
  valueField: RefObject<HTMLInputElement | null>;
  setPinned: Dispatch<SetStateAction<Target | undefined>>;
}) {
  return (
    <form.Field name="value">
      {(field) => (
        <div className="space-y-3">
          <Specification characteristic={characteristic} value={field.state.value} />
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="flex h-20 min-w-0 flex-[1_1_16rem] items-center gap-3 rounded-xl border-2 border-input px-5 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
              <input
                ref={valueField}
                id="capture-value"
                aria-label={`Measured ${characteristic.text}`}
                aria-invalid={field.state.meta.errors.length > 0}
                inputMode="decimal"
                autoComplete="off"
                className="tabular min-w-0 flex-1 bg-transparent font-mono text-[2.5rem] font-medium outline-none"
                value={field.state.value}
                onChange={(event) => {
                  const value = event.target.value;
                  // Typing pins the slot; clearing the field releases it.
                  setPinned(value ? (current) => current ?? target : undefined);
                  field.handleChange(value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setPinned(undefined);
                    field.handleChange('');
                  }
                }}
              />
              <span className="text-xl text-muted-foreground">{characteristic.unit}</span>
            </div>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button
                  type="submit"
                  className="h-20 rounded-xl px-7 text-lg"
                  disabled={submitting || taken}
                >
                  Record <Kbd className="ml-1 bg-white/20 text-primary-foreground">↵</Kbd>
                </Button>
              )}
            </form.Subscribe>
          </div>
          {field.state.meta.errors.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {field.state.meta.errors.join(', ')}
            </p>
          )}
        </div>
      )}
    </form.Field>
  );
}
