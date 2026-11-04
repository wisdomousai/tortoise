import * as React from 'react';
import {
  calibrate,
  scannerProfileSchema,
  type CalibrationResult,
  type ScanRoute,
  type ScannerProfile,
} from '@tortoise/devices';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BigAction } from '@/components/big-action';
import { CalibrationCard, useKeyRecorder } from '@/components/scanner-calibration';
import { ProfileCard } from '@/components/scanner-profile-form';
import { ScanTest } from '@/components/scan-readout';
import { DeliveryBadge } from '@/components/status-strip';
import { useScanner } from '@/hooks/use-scanner';
import { cn } from '@/lib/utils';

export { CalibrationCode } from '@/components/scanner-calibration';

/**
 * The profile being edited and the committed one it started from. A new committed `initial`
 * replaces an unedited draft; an edited one is kept until the operator loads the saved profile.
 */
function useScannerDraft(initial: ScannerProfile, revision: number | undefined) {
  const [draft, setDraft] = React.useState(initial);
  const [base, setBase] = React.useState({ profile: initial, revision });
  const edited = JSON.stringify(draft) !== JSON.stringify(base.profile);
  const changedElsewhere = revision !== base.revision;
  const load = () => {
    setBase({ profile: initial, revision });
    setDraft(initial);
  };
  // Adopt a committed change while nothing is edited (state adjusted during render, not in an
  // effect, so the stale draft is never shown).
  if (changedElsewhere && !edited) load();
  const update = (patch: Partial<ScannerProfile>) =>
    setDraft((current) => ({ ...current, ...patch }));
  return { draft, base, edited, changedElsewhere, load, update };
}

/** Save and remove, the last save's result, and a prompt when the saved profile moved on. */
function SaveActions({
  conflict,
  onLoad,
  valid,
  onSave,
  onRemove,
  pending,
  saved,
}: {
  conflict: boolean;
  onLoad: () => void;
  valid: boolean;
  onSave: () => void;
  onRemove?: () => void;
  pending: boolean;
  saved?: { ok: boolean; message?: string };
}) {
  return (
    <>
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-op-attention p-3"
        >
          <span>The saved profile changed since you started editing.</span>
          <Button type="button" variant="outline" onClick={onLoad}>
            Load saved profile
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-(--operator-gap)">
        <BigAction
          className="sm:w-auto sm:min-w-64"
          label="Save profile"
          pending={pending}
          disabled={!valid}
          onAction={onSave}
        />
        {onRemove && (
          <BigAction
            className="sm:w-auto"
            tone="negative"
            size="compact"
            hold
            label="Remove scanner"
            pending={pending}
            onAction={onRemove}
          />
        )}
        {saved && (
          <DeliveryBadge
            state={saved.ok ? 'accepted' : 'rejected'}
            reference={saved.ok ? 'Saved' : undefined}
            reason={saved.ok ? undefined : { code: 'Not saved', message: saved.message ?? '' }}
          />
        )}
      </div>
    </>
  );
}

/**
 * Set up any barcode scanner without its vendor tool: scan one printed calibration code, apply
 * the inferred settings, check live scans with GS1 and route decoding, then save the profile.
 * Cheap keyboard-wedge scanners are calibrated from their keystrokes; serial, HID POS and camera
 * sources connect on a button press, as browsers require. Saving is the caller's command (for
 * example `device.scanner.save`); this block validates the profile but never persists it.
 *
 * The draft keeps the `revision` it started from and hands it to `onSave`, so a save over a
 * change made elsewhere conflicts instead of overwriting it. A new committed `initial` replaces
 * an unedited draft; an edited one is kept and the operator chooses to load the saved profile.
 */
function ScannerSetup({
  initial,
  revision,
  routes = [],
  onSave,
  onRemove,
  pending = false,
  saved,
  className,
}: {
  initial: ScannerProfile;
  /** Committed revision of `initial`, for optimistic concurrency on save. */
  revision?: number;
  routes?: readonly ScanRoute[];
  /** `base` is the revision the draft was edited from. */
  onSave: (profile: ScannerProfile, base?: number) => void;
  onRemove?: (id: string) => void;
  pending?: boolean;
  /** Result of the last save, as reported by the caller. */
  saved?: { ok: boolean; message?: string };
  className?: string;
}) {
  const { draft, base, edited, changedElsewhere, load, update } = useScannerDraft(
    initial,
    revision,
  );
  const [result, setResult] = React.useState<CalibrationResult>();
  const recorder = useKeyRecorder((keys) => setResult(calibrate(keys)));
  const scanner = useScanner({ profile: draft, routes, enabled: !recorder.recording });
  const validation = scannerProfileSchema.safeParse(draft);

  return (
    <div
      data-slot="scanner-setup"
      className={cn('grid gap-(--operator-gap) lg:grid-cols-2', className)}
    >
      <CalibrationCard recorder={recorder} result={result} onApply={update} />
      <ProfileCard
        draft={draft}
        update={update}
        issues={
          validation.success
            ? []
            : validation.error.issues.map(
                (issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`,
              )
        }
      />

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-(length:--operator-text-lg)">3 · Test and save</CardTitle>
          <CardDescription className="text-(length:--operator-text)">
            Scan real labels. Each scan is decoded with the profile above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-(--operator-gap) text-(length:--operator-text)">
          <ScanTest scanner={scanner} wedge={draft.transport === 'wedge'} />
          <SaveActions
            conflict={changedElsewhere && edited}
            onLoad={load}
            valid={validation.success}
            onSave={() => validation.success && onSave(validation.data, base.revision)}
            onRemove={onRemove && (() => onRemove(draft.id))}
            pending={pending}
            saved={saved}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export { ScannerSetup };
