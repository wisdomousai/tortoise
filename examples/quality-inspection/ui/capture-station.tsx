import { CaptureHeading, TakenAlert } from './capture-station/capture-heading';
import { CharacteristicSamples } from './capture-station/characteristic-samples';
import { CodeEntry } from './capture-station/code-entry';
import type { CodeGroups, LotDetail } from './capture-station/format';
import { useCapture, type CaptureForm } from './capture-station/use-capture';
import { ValueEntry } from './capture-station/value-entry';
import { Kbd } from '@/components/ui/kbd';

export type { CodeGroups, LotDetail } from './capture-station/format';

/** Shown once every sample is recorded, or when the lot no longer accepts capture. */
function NothingToMeasure({ status }: { status: LotDetail['status'] }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">
        {status === 'open' ? 'All samples recorded' : `Lot is ${status}`}
      </h2>
      <p className="text-sm text-muted-foreground">
        {status === 'open'
          ? 'A supervisor can now set the usage decision.'
          : 'Capture is closed for this lot.'}
      </p>
    </div>
  );
}

/** The commit's own failure, such as a conflict or a refused value. */
function SubmitError({ form }: { form: CaptureForm }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        typeof error === 'string' ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function KeyHints() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-muted-foreground">
      <span>
        <Kbd>Enter</Kbd> record
      </span>
      <span>
        <Kbd>Esc</Kbd> clear
      </span>
      <span>Gauge or scanner input goes straight into the value field</span>
    </p>
  );
}

/**
 * Full-height capture surface for one lot. Optimized for producing one datapoint at the moment
 * of measurement: the worklist names the next sample, focus returns to the value field after
 * every commit, Enter records, a keyboard-wedge gauge or scanner works without a mouse, and
 * qualitative codes are one tap or one digit. Every datapoint carries its time-to-commit.
 */
export function CaptureStation({ lot, codeGroups }: { lot: LotDetail; codeGroups: CodeGroups }) {
  const capture = useCapture(lot, codeGroups);
  const { target, characteristic, taken, form, discard } = capture;
  if (!target || !characteristic) return <NothingToMeasure status={lot.status} />;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Capture" className="space-y-5 rounded-2xl border bg-card p-7">
        <CaptureHeading
          characteristic={characteristic}
          target={target}
          overridden={capture.override !== undefined && !taken}
          onDiscard={discard}
        />
        {taken && (
          <TakenAlert
            characteristic={characteristic}
            target={target}
            taken={taken}
            onDiscard={discard}
          />
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {characteristic.kind === 'quantitative' ? (
            <ValueEntry
              form={form}
              characteristic={characteristic}
              target={target}
              taken={taken !== undefined}
              valueField={capture.valueField}
              setPinned={capture.setPinned}
            />
          ) : (
            <CodeEntry
              form={form}
              characteristic={characteristic}
              codes={capture.codes}
              onPick={capture.submitCode}
            />
          )}
          <SubmitError form={form} />
        </form>
        <p
          role="status"
          aria-live="polite"
          className="min-h-11 rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm empty:bg-transparent"
        >
          {capture.announcement}
        </p>
        <KeyHints />
      </section>
      <aside aria-label="Characteristics" className="space-y-2.5">
        {lot.characteristics.map((item) => (
          <CharacteristicSamples
            key={item.id}
            characteristic={item}
            target={target}
            onSelect={(sample) => capture.setOverride({ characteristicId: item.id, sample })}
          />
        ))}
      </aside>
    </div>
  );
}
