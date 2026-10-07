import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { CaptureStation, type CodeGroups, type LotDetail } from '@/components/capture-station';
import { SyncMarker } from '@/components/sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { client, live, transport } from '@/lib/session';

/** Capture station route: one lot, its live results and the actions that close it out. */
export function CaptureScreen() {
  const { lotId } = useParams({ from: '/inspection/$lotId' });
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            to="/inspection"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden /> Lots
          </Link>
          <h1 className="text-2xl font-semibold">
            Lot <span className="font-mono">{data.id}</span> · {data.materialText}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.material}
            {data.batch ? ` · batch ${data.batch}` : ''} · {data.quantity} {data.unit} · plant{' '}
            {data.plant}
          </p>
        </div>
        <div className="w-64 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span className="tabular">
              {data.recorded} / {data.required}
            </span>
          </div>
          <Progress value={(100 * data.recorded) / Math.max(1, data.required)} />
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{data.status}</Badge>
            {data.pendingSync > 0 && (
              <Badge variant="outline" className="border-warning/50 text-warning">
                {data.pendingSync} awaiting quality system
              </Badge>
            )}
            {data.rejectedSync > 0 && (
              <Badge variant="destructive">{data.rejectedSync} rejected</Badge>
            )}
          </div>
        </div>
      </header>
      <CaptureStation lot={data} codeGroups={codes.data.groups} />
      <div className="grid gap-6 lg:grid-cols-2">
        {data.status === 'open' && <DefectForm lot={data} codeGroups={codes.data.groups} />}
        <DecisionPanel lot={data} />
      </div>
    </div>
  );
}

function DefectForm({ lot, codeGroups }: { lot: LotDetail; codeGroups: CodeGroups }) {
  const [saved, setSaved] = useState('');
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
    onCommitted: (receipt) => {
      setSaved(`Defect ${receipt.result.code} recorded`);
      form.reset();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a defect</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
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
            <Button type="submit" variant="secondary">
              Record defect
            </Button>
            <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
              {(error) =>
                typeof error === 'string' ? (
                  <span role="alert" className="text-sm text-destructive">
                    {error}
                  </span>
                ) : (
                  <span role="status" className="text-sm text-muted-foreground">
                    {saved}
                  </span>
                )
              }
            </form.Subscribe>
          </div>
        </form>
        {lot.defects.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {lot.defects.map((defect) => (
              <li key={defect.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-mono">{defect.code}</span> × {defect.quantity}
                  {defect.note ? ` · ${defect.note}` : ''}
                </span>
                <SyncMarker
                  sync={defect.sync}
                  sorRef={defect.sorRef}
                  rejection={defect.rejection}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
      <Card>
        <CardHeader>
          <CardTitle>Usage decision</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 text-sm">
          <span>
            <strong className="capitalize">{lot.decision.code}</strong> by {lot.decision.decidedBy}
            {lot.decision.note ? ` · ${lot.decision.note}` : ''}
          </span>
          <SyncMarker
            sync={lot.decision.sync}
            sorRef={lot.decision.sorRef}
            rejection={lot.decision.rejection}
          />
        </CardContent>
      </Card>
    );
  if (lot.status !== 'open' || lot.next !== null) return null;
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
    <Card>
      <CardHeader>
        <CardTitle>Usage decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
    </Card>
  );
}
