import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft, Clock3, CircleAlert } from 'lucide-react';
import { operations } from '../contracts';
import { CaptureStation, type CodeGroups, type LotDetail } from './capture-station';
import { DecisionPanel } from './capture/decision-panel';
import { DefectForm } from './capture/defect-form';
import { SyncMarker } from './sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/session';

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
