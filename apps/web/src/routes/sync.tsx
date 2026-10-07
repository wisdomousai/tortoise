import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { OutputOf } from '@agent-native/contracts';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { syncStatusQuery } from '@/components/sync-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { live, transport } from '@/lib/session';

type Rejection = OutputOf<typeof operations.syncStatus>['rejections'][number];
const time = (at: number | undefined) => (at === undefined ? '—' : new Date(at).toLocaleString());

/**
 * Outbox and master-data synchronization. Rejections are resolved by superseding the record
 * through the same correction command an agent uses in the triage-rejections workflow.
 */
export function SyncScreen() {
  const status = useQuery(syncStatusQuery());
  if (!status.data) return <p role="status">Loading synchronization…</p>;
  const data = status.data;
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">QUALITY SYSTEM</p>
        <h1 className="text-2xl font-semibold">Synchronization</h1>
        <p className="text-sm text-muted-foreground">
          A saved result is committed locally first, then forwarded. The quality system may still
          reject it; resolve rejections here or ask an agent to triage them.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sync counts">
        <Count
          title="Awaiting quality system"
          value={data.pending}
          detail={
            data.retrying ? `${data.retrying} retrying` : `oldest ${time(data.oldestPendingAt)}`
          }
        />
        <Count
          title="Accepted"
          value={data.accepted}
          detail="Confirmed with a quality system reference"
        />
        <Count title="Rejected" value={data.rejected} detail="Needs a correction or follow-up" />
        <Count
          title="Master data"
          value={data.watermark ?? '—'}
          detail={`Last sync ${time(data.lastSyncAt)}`}
        />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Rejections</CardTitle>
          <CardDescription>
            Corrections supersede the rejected record; the original stays for audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.rejections.length ? (
            data.rejections.map((rejection) => (
              <RejectionRow key={rejection.resource} rejection={rejection} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No open rejections.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Count({
  title,
  value,
  detail,
}: {
  title: string;
  value: number | string;
  detail: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="tabular text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function RejectionRow({ rejection }: { rejection: Rejection }) {
  const [open, setOpen] = useState(false);
  const isResult = rejection.resource.startsWith('result:');
  return (
    <article className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">{rejection.code}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{rejection.resource}</span>
          </div>
          <p className="text-sm">{rejection.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/inspection/$lotId" params={{ lotId: rejection.lotId }}>
              Open lot {rejection.lotId}
            </Link>
          </Button>
          {isResult && (
            <Button size="sm" onClick={() => setOpen((value) => !value)}>
              {open ? 'Cancel' : 'Correct result'}
            </Button>
          )}
        </div>
      </div>
      {open && isResult && (
        <CorrectionForm
          resultId={rejection.resource.slice('result:'.length)}
          lotId={rejection.lotId}
          onDone={() => setOpen(false)}
        />
      )}
    </article>
  );
}

function CorrectionForm({
  resultId,
  lotId,
  onDone,
}: {
  resultId: string;
  lotId: string;
  onDone: () => void;
}) {
  const lot = useQuery(live.liveQueryOptions(operations.lotGet, { id: lotId }));
  const characteristic = lot.data?.characteristics.find((item) =>
    item.results.some((result) => result.id === resultId),
  );
  const original = characteristic?.results.find((result) => result.id === resultId);
  const { form } = useCapabilityForm(transport, operations.resultCorrect, {
    defaultValues: { value: '', code: '', reason: '' },
    toInput: (values) => {
      const qualitative = characteristic?.kind === 'qualitative';
      // A blank field is a missing value, not a measured zero.
      if (!qualitative && values.value.trim() === '') throw new Error('Enter the corrected value');
      return {
        resultId,
        reason: values.reason,
        ...(qualitative
          ? { code: values.code }
          : { value: Number(values.value.replace(',', '.')) }),
      };
    },
    onCommitted: onDone,
  });
  if (!characteristic || !original) return <p role="status">Loading result…</p>;
  const quantitative = characteristic.kind === 'quantitative';
  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground sm:col-span-3">
        {characteristic.text} sample {original.sample}: recorded{' '}
        <strong>{original.value ?? original.code}</strong> {characteristic.unit}
      </p>
      <form.Field name={quantitative ? 'value' : 'code'}>
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor={`correct-${resultId}`}>
              Corrected {quantitative ? 'value' : 'code'}
            </Label>
            <Input
              id={`correct-${resultId}`}
              inputMode={quantitative ? 'decimal' : 'text'}
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
      <form.Field name="reason">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor={`reason-${resultId}`}>Reason</Label>
            <Input
              id={`reason-${resultId}`}
              value={field.state.value}
              placeholder="What was wrong with the original entry?"
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            )}
          </div>
        )}
      </form.Field>
      <Button type="submit">Submit correction</Button>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) =>
          typeof error === 'string' ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-3">
              {error}
            </p>
          ) : null
        }
      </form.Subscribe>
    </form>
  );
}
