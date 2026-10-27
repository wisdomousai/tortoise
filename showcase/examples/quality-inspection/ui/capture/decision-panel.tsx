import { useState } from 'react';
import { operations } from '../../contracts';
import type { LotDetail } from '../capture-station';
import { SyncMarker } from '../sync-status';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/session';

/** The decision taken, by whom, and whether the quality system accepted it. */
function DecisionRecorded({ decision }: { decision: NonNullable<LotDetail['decision']> }) {
  return (
    <section aria-label="Usage decision" className="space-y-2 rounded-2xl border bg-card px-5 py-4">
      <h2 className="text-base font-semibold">Usage decision</h2>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>
          <strong className="capitalize">{decision.code}</strong> by {decision.decidedBy}
          {decision.note ? ` · ${decision.note}` : ''}
        </span>
        <SyncMarker sync={decision.sync} sorRef={decision.sorRef} rejection={decision.rejection} />
      </div>
    </section>
  );
}

/** Before every sample is measured the decision is not offered, only how far there is to go. */
function DecisionWaiting({ lot }: { lot: LotDetail }) {
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

/**
 * Usage decision. It pins the lot revision the supervisor reviewed: a result recorded after
 * this screen rendered makes the decision conflict instead of silently deciding on stale data.
 */
export function DecisionPanel({ lot }: { lot: LotDetail }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (lot.decision) return <DecisionRecorded decision={lot.decision} />;
  if (lot.status !== 'open') return null;
  if (lot.next !== null) return <DecisionWaiting lot={lot} />;
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
