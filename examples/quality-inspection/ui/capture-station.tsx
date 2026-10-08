import { useMemo, useRef, useState } from 'react';
import type { OutputOf } from '@agent-native/contracts';
import { useCaptureLoop, useScannerInput } from '@agent-native/react/capture';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../contracts';
import { SyncMarker } from './sync-status';
import { ToleranceGauge } from '@/components/numeric-pad';
import { parseEntry } from '@/lib/numeric-entry';
import { TilePicker } from '@/components/tile-picker';
import { Button } from '@/components/ui/button';
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
  // The slot a draft belongs to, pinned when typing starts. Live updates may advance the worklist
  // while the operator types; the value still describes the sample they were measuring.
  const [pinned, setPinned] = useState<Target>();
  const [announcement, setAnnouncement] = useState('');
  const target = override ?? pinned ?? lot.next ?? undefined;
  const characteristic = lot.characteristics.find((item) => item.id === target?.characteristicId);
  // Another caller recorded the draft's sample first: the draft is not silently moved elsewhere.
  const taken = characteristic?.results.find((result) => result.sample === target?.sample);
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
      if (taken) throw new Error(`Sample ${target.sample} is already recorded`);
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
      setPinned(undefined);
      form.reset();
    },
  });
  const discard = () => {
    setOverride(undefined);
    setPinned(undefined);
    form.reset();
  };

  const submitCode = (code: string) => {
    form.setFieldValue('code', code);
    scanner.markTouch();
    void form.handleSubmit();
  };

  if (!target || !characteristic)
    return (
      <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
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
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Capture" className="space-y-5 rounded-2xl border bg-card p-7">
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
            {override && !taken && (
              <Button variant="link" className="h-auto px-0" onClick={discard}>
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
        {taken && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <span>
              Sample {target.sample} was recorded elsewhere as{' '}
              <strong className="tabular">
                {taken.value !== undefined
                  ? format(taken.value, characteristic.decimals)
                  : taken.code}
              </strong>
              . Your entry was not saved.
            </span>
            <Button variant="outline" size="sm" onClick={discard}>
              Discard my entry
            </Button>
          </div>
        )}
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
                          disabled={submitting || taken !== undefined}
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
          ) : (
            <form.Field name="code">
              {(field) => (
                <div className="space-y-3">
                  {/* Registry tile picker: digit hotkeys, paging and a tap guard against double taps. */}
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(submitting) => (
                      <TilePicker
                        label={`Code for ${characteristic.text}`}
                        pending={submitting}
                        tiles={codes.map((code) => ({
                          value: code.code,
                          label: <span className="font-mono">{code.code}</span>,
                          detail: code.text,
                          tone: code.valuation === 'rejected' ? 'negative' : 'neutral',
                        }))}
                        onPick={submitCode}
                      />
                    )}
                  </form.Subscribe>
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
        <p
          role="status"
          aria-live="polite"
          className="min-h-11 rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm empty:bg-transparent"
        >
          {announcement}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-muted-foreground">
          <span>
            <Kbd>Enter</Kbd> record
          </span>
          <span>
            <Kbd>Esc</Kbd> clear
          </span>
          <span>Gauge or scanner input goes straight into the value field</span>
        </p>
      </section>
      <aside aria-label="Characteristics" className="space-y-2.5">
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

/** The specification limits in the rail, for example `· 219.90–220.10` or `· ≤ 0.05`. */
function spec({ kind, lower, upper, decimals }: Characteristic) {
  if (kind === 'qualitative') return ' · code';
  if (lower !== undefined && upper !== undefined)
    return ` · ${format(lower, decimals)}–${format(upper, decimals)}`;
  if (upper !== undefined) return ` · ≤ ${format(upper, decimals)}`;
  if (lower !== undefined) return ` · ≥ ${format(lower, decimals)}`;
  return '';
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
