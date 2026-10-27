import { TilePicker } from '@/components/tile-picker';
import type { Characteristic, CodeGroups } from './format';
import type { CaptureForm } from './use-capture';

/** A qualitative result is one tap or one digit; picking a code records it. */
export function CodeEntry({
  form,
  characteristic,
  codes,
  onPick,
}: {
  form: CaptureForm;
  characteristic: Characteristic;
  codes: CodeGroups[number]['codes'];
  onPick: (code: string) => void;
}) {
  return (
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
                onPick={onPick}
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
  );
}
