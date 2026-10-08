import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import type { OutputOf } from '@agent-native/contracts';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../contracts';
import { syncStatusQuery } from './sync-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { live, transport } from '@/lib/session';
import { cn } from '@/lib/utils';

type Rejection = OutputOf<typeof operations.syncStatus>['rejections'][number];
const clock = (at: number | undefined) =>
  at === undefined
    ? undefined
    : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const age = (at: number | undefined) => {
  if (at === undefined) return undefined;
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
};

/** Reasons people give most; the text is what the audit trail and the quality system receive. */
const reasons = ['Value was right, send again', 'Typing error', 'Measured again'];

/**
 * Records the quality system refused, and how delivery stands. A rejection is resolved by
 * superseding the record through the same correction command an agent uses in the
 * triage-rejections workflow; the original stays for audit.
 */
export function AttentionScreen() {
  const status = useQuery(syncStatusQuery());
  if (!status.data) return <p role="status">Loading synchronization…</p>;
  const data = status.data;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Needs attention</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you record is saved here first, then sent to the quality system. These were
          refused there. The originals stay on record; a correction replaces them.
        </p>
      </header>
      <section
        aria-label="Delivery"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-5 py-3.5 text-sm"
      >
        <span>
          <strong className="tabular-nums">{data.pending}</strong> sending
          {data.pending > 0 && data.oldestPendingAt !== undefined
            ? `, oldest ${age(data.oldestPendingAt)}`
            : ''}
        </span>
        {data.retrying > 0 && (
          <span className="text-amber-800">
            <strong className="tabular-nums">{data.retrying}</strong> retrying
          </span>
        )}
        <span>
          <strong className="tabular-nums">{data.accepted}</strong> accepted
        </span>
        <span>
          <strong className="tabular-nums">{data.rejected}</strong> rejected
        </span>
        <span className="text-muted-foreground sm:ml-auto">
          {data.lastSyncAt !== undefined
            ? `Lots and specifications synced ${clock(data.lastSyncAt)}`
            : 'Lots and specifications not synced yet'}
        </span>
      </section>
      <section aria-label="Rejected by the quality system" className="space-y-4">
        {data.rejections.length ? (
          data.rejections.map((rejection) => (
            <RejectionCard key={rejection.resource} rejection={rejection} />
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card p-10 text-center">
            <CircleCheck className="size-8 text-success" aria-hidden />
            <p className="font-medium">Nothing refused</p>
            <p className="text-sm text-muted-foreground">
              Everything the quality system answered so far was accepted.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function RejectionCard({ rejection }: { rejection: Rejection }) {
  const isResult = rejection.resource.startsWith('result:');
  const resultId = isResult ? rejection.resource.slice('result:'.length) : undefined;
  const lot = useQuery({
    ...live.liveQueryOptions(operations.lotGet, { id: rejection.lotId }),
    enabled: isResult,
  });
  const characteristic = lot.data?.characteristics.find((item) =>
    item.results.some((result) => result.id === resultId),
  );
  const original = characteristic?.results.find((result) => result.id === resultId);
  const what =
    characteristic && original
      ? `${characteristic.text}, sample ${original.sample}`
      : rejection.resource.split(':')[0];
  return (
    <article className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1.5">
          <span className="inline-flex rounded-md bg-destructive/10 px-2 py-0.5 font-mono text-xs font-semibold text-destructive">
            {rejection.code}
          </span>
          <h2 className="font-semibold">
            {what} · lot <span className="font-mono">{rejection.lotId}</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            “{rejection.message}”
            {original && characteristic && (
              <>
                {' '}
                You recorded{' '}
                <strong className="text-foreground">
                  {original.value ?? original.code} {characteristic.unit}
                </strong>
                .
              </>
            )}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{rejection.resource}</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/inspection/$lotId" params={{ lotId: rejection.lotId }}>
            Open lot
          </Link>
        </Button>
      </div>
      {resultId && characteristic && original && (
        <CorrectionForm
          resultId={resultId}
          quantitative={characteristic.kind === 'quantitative'}
          unit={characteristic.unit}
          recorded={String(original.value ?? original.code ?? '')}
        />
      )}
      {!isResult && (
        <p className="border-t bg-muted/40 px-5 py-3 text-sm text-muted-foreground">
          Only results can be corrected here. Follow this one up in the quality system.
        </p>
      )}
    </article>
  );
}

/** Inline correction: the value to send (prefilled with the original) and why. */
function CorrectionForm({
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
