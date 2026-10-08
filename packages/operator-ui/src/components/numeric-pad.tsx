import * as React from 'react';
import { CornerDownLeft, Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOperatorKeys } from '@/hooks/use-operator-keys';
import {
  applyKey,
  parseEntry,
  toleranceState,
  type EntryRules,
  type Tolerance,
} from '@/lib/numeric-entry';
import { cn } from '@/lib/utils';

/** Live gauge of a value against its tolerance band; text states the verdict for non-color readers. */
function ToleranceGauge({
  value,
  tolerance,
  unit,
  decimals,
}: {
  value: number | undefined;
  tolerance: Tolerance;
  unit?: string;
  decimals?: number;
}) {
  const { inside, position } = toleranceState(value, tolerance);
  const format = (number: number) =>
    decimals === undefined ? String(number) : number.toFixed(decimals);
  return (
    <div data-slot="tolerance-gauge" className="space-y-2">
      <div className="flex flex-wrap justify-between gap-x-6 text-(length:--operator-text) text-muted-foreground">
        {tolerance.lower !== undefined && tolerance.upper !== undefined && (
          <span>
            {format(tolerance.lower)} – {format(tolerance.upper)} {unit}
          </span>
        )}
        {inside !== undefined && (
          <span className={cn('font-semibold', inside ? 'text-op-ok' : 'text-op-fault')}>
            {inside ? 'In tolerance' : 'Out of tolerance'}
          </span>
        )}
      </div>
      {tolerance.lower !== undefined && tolerance.upper !== undefined && (
        <div aria-hidden className="relative h-4 rounded-full bg-op-fault/20">
          {/* Opaque underlay, so the in-tolerance band is green rather than mixed with the red track. */}
          <div className="absolute inset-y-0 left-1/4 w-1/2 bg-background">
            <div className="size-full bg-op-ok/35" />
          </div>
          {position !== undefined && (
            <div
              className={cn(
                'absolute -top-1.5 h-7 w-1.5 -translate-x-1/2 rounded-full',
                inside ? 'bg-op-ok' : 'bg-op-fault',
              )}
              style={{ left: `${position}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PadKey({
  children,
  onPress,
  extra,
  name,
  pending,
}: {
  children: React.ReactNode;
  onPress: () => void;
  extra?: string;
  name?: string;
  pending: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={name}
      className={cn(
        'touch-operator h-(--operator-target-lg) text-(length:--operator-text-xl) font-semibold tabular-nums',
        extra,
      )}
      onClick={onPress}
      disabled={pending}
    >
      {children}
    </Button>
  );
}

/** The 4-column key grid: digits, delete, clear, submit, sign (when allowed) and separator. */
function Keypad({
  press,
  submit,
  canSubmit,
  pending,
  separator,
  allowNegative,
  submitLabel,
}: {
  press: (key: string) => void;
  submit: () => void;
  canSubmit: boolean;
  pending: boolean;
  separator: string;
  allowNegative?: boolean;
  submitLabel: React.ReactNode;
}) {
  const key = (content: React.ReactNode, onPress: () => void, extra?: string, name?: string) => (
    <PadKey onPress={onPress} extra={extra} name={name} pending={pending}>
      {content}
    </PadKey>
  );
  return (
    <div className="grid grid-cols-4 gap-(--operator-gap)">
      {key('7', () => press('7'))}
      {key('8', () => press('8'))}
      {key('9', () => press('9'))}
      {key(<Delete className="size-8" aria-hidden />, () => press('Backspace'), '', 'Delete digit')}
      {key('4', () => press('4'))}
      {key('5', () => press('5'))}
      {key('6', () => press('6'))}
      {key('C', () => press('Escape'), 'text-(length:--operator-text-lg)', 'Clear')}
      {key('1', () => press('1'))}
      {key('2', () => press('2'))}
      {key('3', () => press('3'))}
      <Button
        type="button"
        className="touch-operator row-span-2 h-auto text-(length:--operator-text-lg) font-semibold"
        disabled={!canSubmit || pending}
        onClick={submit}
      >
        <span className="flex flex-col items-center gap-2">
          <CornerDownLeft className="size-8" aria-hidden />
          {submitLabel}
        </span>
      </Button>
      {allowNegative
        ? key('±', () => press('±'), '', 'Change sign')
        : key('', () => undefined, 'invisible')}
      {key('0', () => press('0'))}
      {key(separator, () => press(separator), '', 'Decimal separator')}
    </div>
  );
}

/**
 * On-screen keypad for measured values with gloves on. Large keys, the unit beside the readout,
 * the configured decimal separator, and the tolerance verdict before submitting. Physical
 * keyboards and USB keypads work too. The value stays a string until `onSubmit` parses it.
 */
function NumericPad({
  value,
  onChange,
  onSubmit,
  unit,
  tolerance,
  pending = false,
  submitLabel = 'Record',
  label,
  keyboard = true,
  className,
  ...rules
}: EntryRules & {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: number) => void;
  unit?: string;
  tolerance?: Tolerance;
  pending?: boolean;
  submitLabel?: React.ReactNode;
  label: string;
  /** Accept digits and Enter from a physical keyboard while no text field has focus. */
  keyboard?: boolean;
  className?: string;
}) {
  const separator = rules.separator ?? '.';
  const parsed = parseEntry(value);
  const press = (key: string) => onChange(applyKey(value, key, rules));
  const submit = () => {
    if (parsed !== undefined && !pending) onSubmit(parsed);
  };
  const bindings: Record<string, () => void> = {
    Backspace: () => press('Backspace'),
    Escape: () => press('Escape'),
    Enter: submit,
    '.': () => press('.'),
    ',': () => press(','),
    '-': () => press('-'),
  };
  for (const digit of '0123456789') bindings[digit] = () => press(digit);
  useOperatorKeys(bindings, { enabled: keyboard });

  return (
    <div
      data-slot="numeric-pad"
      role="group"
      aria-label={label}
      className={cn('space-y-(--operator-gap)', className)}
    >
      <output
        aria-live="polite"
        className="flex min-h-(--operator-target-lg) items-baseline justify-end gap-3 rounded-xl border-2 bg-card px-6 text-(length:--operator-text-xl) font-semibold tabular-nums"
      >
        <span>{value || '0'}</span>
        {unit && (
          <span className="text-(length:--operator-text-lg) text-muted-foreground">{unit}</span>
        )}
      </output>
      {tolerance && (
        <ToleranceGauge
          value={parsed}
          tolerance={tolerance}
          unit={unit}
          decimals={rules.decimals}
        />
      )}
      <Keypad
        press={press}
        submit={submit}
        canSubmit={parsed !== undefined}
        pending={pending}
        separator={separator}
        allowNegative={rules.allowNegative}
        submitLabel={submitLabel}
      />
    </div>
  );
}

export { NumericPad, ToleranceGauge };
