import { useMemo, useRef, useState } from 'react';
import type { OutputOf } from '@agent-native/contracts';
import { useCaptureLoop, useScannerInput } from '@agent-native/react/capture';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { SyncMarker } from '@/components/sync-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { transport } from '@/lib/session';

export type LotDetail = OutputOf<typeof operations.lotGet>;
export type CodeGroups = OutputOf<typeof operations.codeList>['groups'];
type Characteristic = LotDetail['characteristics'][number];
type Target = { characteristicId: string; sample: number };

const format = (value: number, decimals?: number) =>
  decimals === undefined ? String(value) : value.toFixed(decimals);

/**
 * Full-height capture surface for one lot. Optimized for producing one datapoint at the moment
 * of measurement: the worklist names the next sample, focus returns to the value field after
 * every commit, Enter records, a keyboard-wedge gauge or scanner works without a mouse, and
 * qualitative codes are one tap or one digit. Every datapoint carries its time-to-commit.
 */
export function CaptureStation({ lot, codeGroups }: { lot: LotDetail; codeGroups: CodeGroups }) {
  const [override, setOverride] = useState<Target>();
  const [announcement, setAnnouncement] = useState('');
  const target = override ?? lot.next ?? undefined;
  const characteristic = lot.characteristics.find((item) => item.id === target?.characteristicId);
  const codes = useMemo(
    () => codeGroups.find((group) => group.id === characteristic?.codeGroup)?.codes ?? [],
    [codeGroups, characteristic?.codeGroup],
  );
  const valueField = useRef<HTMLInputElement>(null);
  const itemKey = target ? `${target.characteristicId}:${target.sample}` : undefined;
  const { elapsed } = useCaptureLoop(itemKey, valueField);
  const scanner = useScannerInput({});

  const { form } = useCapabilityForm(transport, operations.resultRecord, {
    defaultValues: { value: '', code: '' },
    toInput: (values) => {
      if (!target || !characteristic) throw new Error('Nothing left to measure on this lot');
      const quantitative = characteristic.kind === 'quantitative';
      if (quantitative && values.value.trim() === '') throw new Error('Enter a measured value');
      const durationMs = elapsed();
      return {
        lotId: lot.id,
        characteristicId: target.characteristicId,
        sample: target.sample,
        ...(quantitative
          ? { value: Number(values.value.replace(',', '.')) }
          : { code: values.code }),
        // The measurement happened when the operator confirmed it, not when the server commits.
        occurredAt: Date.now(),
        station: 'web',
        ...(durationMs === undefined ? {} : { capture: { durationMs, input: scanner.lastInput } }),
      };
    },
    onCommitted: (receipt) => {
      const result = receipt.result;
      setAnnouncement(
        `Recorded ${result.value ?? result.code} for ${characteristic?.code} sample ${result.sample}: ${
          result.evaluation === 'accepted' ? 'in tolerance' : 'out of tolerance'
        }`,
      );
      setOverride(undefined);
      form.reset();
    },
  });

  const submitCode = (code: string) => {
    form.setFieldValue('code', code);
    scanner.markTouch();
    void form.handleSubmit();
  };

  if (!target || !characteristic)
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <h2 className="text-lg font-semibold">
          {lot.status === 'open' ? 'All samples recorded' : `Lot is ${lot.status}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lot.status === 'open'
            ? 'A supervisor can now set the usage decision.'
            : 'Capture is closed for this lot.'}
        </p>
      </div>
    );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <section
        aria-label="Capture"
        className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm"
        onKeyDown={(event) => {
          if (characteristic.kind !== 'qualitative') return;
          const index = Number(event.key) - 1;
          if (Number.isInteger(index) && codes[index]) {
            event.preventDefault();
            submitCode(codes[index].code);
          }
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-medium tracking-widest text-muted-foreground">
              NOW MEASURING · SAMPLE {target.sample} OF {characteristic.sampleSize}
            </p>
            <h2 className="text-3xl font-semibold">
              {characteristic.text}{' '}
              <span className="font-mono text-lg text-muted-foreground">{characteristic.code}</span>
            </h2>
          </div>
          {override && (
            <Button variant="ghost" size="sm" onClick={() => setOverride(undefined)}>
              Back to worklist order
            </Button>
          )}
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {characteristic.kind === 'quantitative' ? (
            <form.Field name="value">
              {(field) => (
                <div className="space-y-3">
                  <Specification characteristic={characteristic} value={field.state.value} />
                  <div className="flex items-stretch gap-3">
                    <Input
                      ref={valueField}
                      id="capture-value"
                      aria-label={`Measured ${characteristic.text}`}
                      aria-invalid={field.state.meta.errors.length > 0}
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular h-16 text-3xl md:text-3xl"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') field.handleChange('');
                      }}
                    />
                    <span className="self-center text-xl text-muted-foreground">
                      {characteristic.unit}
                    </span>
                    <form.Subscribe selector={(state) => state.isSubmitting}>
                      {(submitting) => (
                        <Button type="submit" className="h-16 px-6 text-base" disabled={submitting}>
                          Record <Kbd className="ml-2">↵</Kbd>
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
          ) : (
            <form.Field name="code">
              {(field) => (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {codes.map((code, index) => (
                      <Button
                        key={code.code}
                        type="button"
                        ref={index === 0 ? (valueField as never) : undefined}
                        variant="outline"
                        className={cn(
                          'h-20 flex-col items-start gap-1 px-4 text-left whitespace-normal',
                          code.valuation === 'rejected' && 'border-destructive/40',
                        )}
                        onClick={() => submitCode(code.code)}
                      >
                        <span className="flex w-full items-center justify-between font-mono">
                          {code.code}
                          {index < 9 && <Kbd>{index + 1}</Kbd>}
                        </span>
                        <span className="text-xs text-muted-foreground">{code.text}</span>
                      </Button>
                    ))}
                  </div>
                  {field.state.meta.errors.length > 0 && (
                    <p role="alert" className="text-sm text-destructive">
                      {field.state.meta.errors.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          )}
          <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
            {(error) =>
              typeof error === 'string' ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null
            }
          </form.Subscribe>
        </form>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {announcement}
        </p>
      </section>
      <aside aria-label="Characteristics" className="space-y-3">
        {lot.characteristics.map((item) => (
          <CharacteristicSamples
            key={item.id}
            characteristic={item}
            target={target}
            onSelect={(sample) => setOverride({ characteristicId: item.id, sample })}
          />
        ))}
      </aside>
    </div>
  );
}

/** Specification limits with a live gauge of where the typed value falls. */
function Specification({
  characteristic,
  value,
}: {
  characteristic: Characteristic;
  value: string;
}) {
  const { lower, upper, target, unit, decimals } = characteristic;
  const parsed = Number(value.replace(',', '.'));
  const typed = value.trim() !== '' && Number.isFinite(parsed);
  const inside =
    typed && (lower === undefined || parsed >= lower) && (upper === undefined || parsed <= upper);
  const span = lower !== undefined && upper !== undefined ? upper - lower : undefined;
  const position =
    typed && span
      ? Math.min(100, Math.max(0, ((parsed - (lower! - span / 2)) / (span * 2)) * 100))
      : undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        {target !== undefined && (
          <span>
            Target <strong className="tabular text-foreground">{format(target, decimals)}</strong>{' '}
            {unit}
          </span>
        )}
        {lower !== undefined && upper !== undefined && (
          <span>
            Tolerance{' '}
            <strong className="tabular text-foreground">
              {format(lower, decimals)} – {format(upper, decimals)}
            </strong>{' '}
            {unit}
          </span>
        )}
        {typed && (
          <span className={cn('font-medium', inside ? 'text-success' : 'text-destructive')}>
            {inside ? 'In tolerance' : 'Out of tolerance'}
          </span>
        )}
      </div>
      {span !== undefined && (
        <div aria-hidden className="relative h-3 rounded-full bg-destructive/15">
          <div className="absolute inset-y-0 left-1/4 w-1/2 rounded-full bg-success/25" />
          {position !== undefined && (
            <div
              className={cn(
                'absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full',
                inside ? 'bg-success' : 'bg-destructive',
              )}
              style={{ left: `${position}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CharacteristicSamples({
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
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{characteristic.text}</span>
        <span className="font-mono text-xs text-muted-foreground">{characteristic.code}</span>
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
                  'flex min-w-14 flex-col items-center rounded-md border px-2 py-1 text-xs',
                  result.evaluation === 'accepted'
                    ? 'border-success/40 bg-success/10'
                    : 'border-destructive/40 bg-destructive/10',
                )}
              >
                <span className="tabular font-medium">
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
                  'flex min-h-11 min-w-14 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted',
                  current &&
                    'border-solid border-primary bg-primary/5 text-foreground ring-2 ring-primary/30',
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
