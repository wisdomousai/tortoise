import { useMemo, useRef, useState } from 'react';
import type { OutputOf } from '@agent-native/contracts';
import { useCaptureLoop, useScannerInput } from '@agent-native/react/capture';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { SyncMarker } from '@/components/sync-status';
import { ToleranceGauge } from '@/components/numeric-pad';
import { parseEntry } from '@/lib/numeric-entry';
import { TilePicker } from '@/components/tile-picker';
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
      <section aria-label="Capture" className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
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
          {override && !taken && (
            <Button variant="ghost" size="sm" onClick={discard}>
              Back to worklist order
            </Button>
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
                    <span className="self-center text-xl text-muted-foreground">
                      {characteristic.unit}
                    </span>
                    <form.Subscribe selector={(state) => state.isSubmitting}>
                      {(submitting) => (
                        <Button
                          type="submit"
                          className="h-16 px-6 text-base"
                          disabled={submitting || taken !== undefined}
                        >
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
      {target !== undefined && (
        <p className="text-sm text-muted-foreground">
          Target <strong className="tabular text-foreground">{format(target, decimals)}</strong>{' '}
          {unit}
        </p>
      )}
      <ToleranceGauge
        value={parseEntry(value.trim())}
        tolerance={{ lower, upper, target }}
        unit={unit}
        decimals={decimals}
      />
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
