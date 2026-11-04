import { useCapabilityForm } from '@tortoise/react/form';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { transport } from '@/lib/session';
import { cn } from '@/lib/utils';

/** One tap each for the reasons corrections usually have. */
const reasons = ['Value was right, send again', 'Typing error', 'Measured again'];

/** The correction form, bound to `result.correct` and prefilled with the recorded value. */
function useCorrectionForm(resultId: string, quantitative: boolean, recorded: string) {
  const { form } = useCapabilityForm(transport, operations.resultCorrect, {
    defaultValues: { value: recorded, reason: '' },
    toInput: (values) => {
      // A blank field is a missing value, not a measured zero.
      if (values.value.trim() === '')
        throw new Error(quantitative ? 'Enter the corrected value' : 'Enter the corrected code');
      return {
        resultId,
        reason: values.reason,
        ...(quantitative
          ? { value: Number(values.value.replace(',', '.')) }
          : { code: values.value.trim() }),
      };
    },
  });
  return form;
}

/** Common reasons as one tap each, or the reason in the operator's own words. */
function ReasonField({
  form,
  resultId,
}: {
  form: ReturnType<typeof useCorrectionForm>;
  resultId: string;
}) {
  return (
    <form.Field name="reason">
      {(field) => (
        <div className="space-y-1.5">
          <Label htmlFor={`reason-${resultId}`}>Reason</Label>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={field.state.value === reason}
                onClick={() => field.handleChange(reason)}
                className={cn(
                  'h-9 rounded-full border px-3 text-sm',
                  field.state.value === reason
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-input bg-card hover:bg-muted',
                )}
              >
                {reason}
              </button>
            ))}
          </div>
          <Input
            id={`reason-${resultId}`}
            className="h-10 bg-card"
            placeholder="Or say what was wrong"
            value={field.state.value}
            aria-invalid={field.state.meta.errors.length > 0}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          {field.state.meta.errors.length > 0 && (
            <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
          )}
        </div>
      )}
    </form.Field>
  );
}

/** Inline correction: the value to send (prefilled with the original) and why. */
export function CorrectionForm({
  resultId,
  quantitative,
  unit,
  recorded,
}: {
  resultId: string;
  quantitative: boolean;
  unit?: string;
  recorded: string;
}) {
  const form = useCorrectionForm(resultId, quantitative, recorded);
  return (
    <form
      aria-label="Correct result"
      className="space-y-4 border-t bg-muted/40 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <form.Field name="value">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor={`correct-${resultId}`}>
                {quantitative ? 'Value to send' : 'Code to send'}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`correct-${resultId}`}
                  inputMode={quantitative ? 'decimal' : 'text'}
                  className="h-11 bg-card font-mono text-lg md:text-lg"
                  value={field.state.value}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {unit && <span className="text-muted-foreground">{unit}</span>}
              </div>
              {field.state.meta.errors.length > 0 && (
                <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
              )}
            </div>
          )}
        </form.Field>
        <ReasonField form={form} resultId={resultId} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              Send correction
            </Button>
          )}
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            typeof error === 'string' ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null
          }
        </form.Subscribe>
      </div>
    </form>
  );
}
