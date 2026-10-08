import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft, Clock3, CircleAlert } from 'lucide-react';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../contracts';
import { CaptureStation, type CodeGroups, type LotDetail } from './capture-station';
import { SyncMarker } from './sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { client, live, transport } from '@/lib/session';

/** Capture station route: one lot, its live results and the actions that close it out. */
export function CaptureScreen() {
  const { lotId } = useParams({ strict: false }) as { lotId: string };
  const lot = useQuery(live.liveQueryOptions(operations.lotGet, { id: lotId }));
  const codes = useQuery(live.liveQueryOptions(operations.codeList, {}));
  if (lot.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          {lot.error.message}. <Link to="/inspection">Back to lots</Link>
        </AlertDescription>
      </Alert>
    );
  if (!lot.data || !codes.data) return <p role="status">Loading lot…</p>;
  const data = lot.data;
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/inspection"
            className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden /> Lots
          </Link>
          <h1 className="mt-1 text-[1.6rem] font-semibold tracking-tight">
            <span className="font-mono">{data.id}</span> · {data.materialText}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.material}
            {data.batch ? ` · batch ${data.batch}` : ''} · {data.quantity} {data.unit} · plant{' '}
            {data.plant}
            {data.status !== 'open' ? ` · ${data.status}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5" aria-label="Progress">
            <div className="h-2 w-40 rounded-full bg-foreground/10">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${(100 * data.recorded) / Math.max(1, data.required)}%` }}
              />
            </div>
            <span className="font-mono text-[0.95rem] font-semibold">
              {data.recorded} / {data.required}
            </span>
          </div>
          {data.pendingSync > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[0.8rem] text-amber-800">
              <Clock3 className="size-3.5" aria-hidden />
              {data.pendingSync} sending to quality system
            </span>
          )}
          {data.rejectedSync > 0 && (
            <Link
              to="/attention"
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[0.8rem] font-medium text-destructive hover:underline"
            >
              <CircleAlert className="size-3.5" aria-hidden />
              {data.rejectedSync} rejected
            </Link>
          )}
        </div>
      </header>
      <CaptureStation lot={data} codeGroups={codes.data.groups} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Defects lot={data} codeGroups={codes.data.groups} />
        <DecisionPanel lot={data} />
      </div>
    </div>
  );
}

/** Defects on the lot, and the form to report one while the lot is open. */
function Defects({ lot, codeGroups }: { lot: LotDetail; codeGroups: CodeGroups }) {
  const [reporting, setReporting] = useState(false);
  const open = lot.status === 'open';
  if (!open && !lot.defects.length) return null;
  return (
    <section aria-label="Defects" className="space-y-3 rounded-2xl border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Defects on this lot</h2>
        {open && (
          <Button variant="outline" onClick={() => setReporting((value) => !value)}>
            {reporting ? 'Cancel' : 'Report a defect'}
          </Button>
        )}
      </div>
      {lot.defects.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {lot.defects.map((defect) => (
            <li key={defect.id} className="flex items-center gap-2.5">
              <span className="font-mono font-semibold">{defect.code}</span>
              <span className="min-w-0 flex-1">
                × {defect.quantity}
                {defect.characteristicId
                  ? ` · ${lot.characteristics.find((item) => item.id === defect.characteristicId)?.text ?? defect.characteristicId}`
                  : ''}
                {defect.note ? ` · ${defect.note}` : ''}
              </span>
              <SyncMarker sync={defect.sync} sorRef={defect.sorRef} rejection={defect.rejection} />
            </li>
          ))}
        </ul>
      ) : (
        !reporting && <p className="text-sm text-muted-foreground">None reported.</p>
      )}
      {open && reporting && (
        <DefectForm lot={lot} codeGroups={codeGroups} onDone={() => setReporting(false)} />
      )}
    </section>
  );
}

function DefectForm({
  lot,
  codeGroups,
  onDone,
}: {
  lot: LotDetail;
  codeGroups: CodeGroups;
  onDone: () => void;
}) {
  const defects = codeGroups.find((group) => group.id === 'defects')?.codes ?? [];
  const { form } = useCapabilityForm(transport, operations.defectRecord, {
    defaultValues: { code: defects[0]?.code ?? '', quantity: '1', characteristicId: '', note: '' },
    toInput: (values) => ({
      lotId: lot.id,
      code: values.code,
      quantity: Number(values.quantity),
      ...(values.characteristicId ? { characteristicId: values.characteristicId } : {}),
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    }),
    onCommitted: () => {
      form.reset();
      onDone();
    },
  });
  return (
    <form
      aria-label="Report a defect"
      className="grid gap-3 border-t pt-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="code">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-code">Defect code</Label>
            <NativeSelect
              id="defect-code"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              {defects.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.code} · {code.text}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="quantity">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-quantity">Quantity</Label>
            <Input
              id="defect-quantity"
              inputMode="numeric"
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
      <form.Field name="characteristicId">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-characteristic">Characteristic</Label>
            <NativeSelect
              id="defect-characteristic"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Whole lot</option>
              {lot.characteristics.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.text}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="note">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-note">Note</Label>
            <Input
              id="defect-note"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </div>
        )}
      </form.Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit">Record defect</Button>
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            typeof error === 'string' ? (
              <span role="alert" className="text-sm text-destructive">
                {error}
              </span>
            ) : null
          }
        </form.Subscribe>
      </div>
    </form>
  );
}

/**
 * Usage decision. It pins the lot revision the supervisor reviewed: a result recorded after
 * this screen rendered makes the decision conflict instead of silently deciding on stale data.
 */
function DecisionPanel({ lot }: { lot: LotDetail }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (lot.decision)
    return (
      <section
        aria-label="Usage decision"
        className="space-y-2 rounded-2xl border bg-card px-5 py-4"
      >
        <h2 className="text-base font-semibold">Usage decision</h2>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            <strong className="capitalize">{lot.decision.code}</strong> by {lot.decision.decidedBy}
            {lot.decision.note ? ` · ${lot.decision.note}` : ''}
          </span>
          <SyncMarker
            sync={lot.decision.sync}
            sorRef={lot.decision.sorRef}
            rejection={lot.decision.rejection}
          />
        </div>
      </section>
    );
  if (lot.status !== 'open') return null;
  if (lot.next !== null) {
    const remaining = lot.required - lot.recorded;
    return (
      <section
        aria-label="Usage decision"
        className="space-y-1 rounded-2xl border border-dashed bg-muted/40 px-5 py-4"
      >
        <h2 className="text-base font-semibold">Usage decision</h2>
        <p className="text-sm text-muted-foreground">
          Opens for a supervisor when all {lot.required} samples are measured. {remaining} to go.
        </p>
      </section>
    );
  }
  const decide = async (code: 'accept' | 'reject' | 'conditional') => {
    setPending(true);
    setError('');
    try {
      await client.command(
        operations.decisionSet,
        { lotId: lot.id, code },
        { expectedRevisions: { [`lot:${lot.id}`]: lot.revision } },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision failed');
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label="Usage decision"
      className="space-y-3 rounded-2xl border-2 border-primary bg-card px-5 py-4"
    >
      <h2 className="text-base font-semibold">Usage decision</h2>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          All samples are recorded ({lot.outOfTolerance} out of tolerance). Supervisors decide; the
          decision is forwarded to the quality system.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => void decide('accept')}>
            Accept lot
          </Button>
          <Button disabled={pending} variant="outline" onClick={() => void decide('conditional')}>
            Accept conditionally
          </Button>
          <Button disabled={pending} variant="destructive" onClick={() => void decide('reject')}>
            Reject lot
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
