import { useCapabilityForm } from '@agent-native/react/form';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { transport } from '@/lib/session';
import { operations } from '../../contracts';

type Kind = 'call' | 'meeting' | 'note';

/** Log a call, meeting or note; it is saved here first and then sent to the CRM. */
export function ActivityForm({ accountId }: { accountId: string }) {
  const { form } = useCapabilityForm(transport, operations.activityLog, {
    defaultValues: { kind: 'call' as Kind, summary: '' },
    // Stamped once per attempt, so a retry replays the same activity instead of a new one.
    toInput: (values) => ({ accountId, ...values, occurredAt: Date.now() }),
    onCommitted: () => form.reset(),
  });
  return (
    <form
      aria-label="Log activity"
      className="space-y-3 rounded-2xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="kind">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="activity-kind">Kind</Label>
            <NativeSelect
              id="activity-kind"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as Kind)}
            >
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="summary">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="activity-summary">What happened</Label>
            <Textarea
              id="activity-summary"
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
      <div className="flex flex-wrap items-center gap-3">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              Log activity
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
