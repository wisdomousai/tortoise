import * as React from 'react';
import bwipjs from 'bwip-js/browser';
import { CircleAlert, CircleCheck, Plug, ScanLine, Wand2 } from 'lucide-react';
import {
  CALIBRATION_CODE,
  GROUP_SEPARATOR,
  calibrate,
  keyboardLayouts,
  scannerProfileSchema,
  scannerTransports,
  type CalibrationResult,
  type RecordedKey,
  type ScanRoute,
  type ScannerProfile,
} from '@agent-native/devices';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BigAction } from '@/components/big-action';
import { DeliveryBadge } from '@/components/status-strip';
import { useScanner } from '@/hooks/use-scanner';
import { cn } from '@/lib/utils';

/** Show control characters so a technician can see what the scanner really sent. */
const visible = (text: string) =>
  text.replaceAll(GROUP_SEPARATOR, '⟨GS⟩').replaceAll('\t', '⟨TAB⟩').replaceAll('\r', '⟨CR⟩');

/** The calibration code as Code 128, which every 1D and 2D scanner reads. */
function CalibrationCode({ className }: { className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    if (!canvas.current) return;
    try {
      bwipjs.toCanvas(canvas.current, {
        bcid: 'code128',
        // `parse` turns ^029 into the ASCII group separator inside the symbol.
        text: CALIBRATION_CODE.replaceAll(GROUP_SEPARATOR, '^029'),
        parse: true,
        scale: 3,
        height: 14,
        paddingwidth: 10,
        paddingheight: 6,
        backgroundcolor: 'ffffff',
      });
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  return error ? (
    <p className="text-op-fault">Calibration code could not be drawn: {error}</p>
  ) : (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Calibration barcode"
      className={cn('max-w-full rounded-md border bg-white', className)}
    />
  );
}

/** Record raw key events until the terminator or a pause, without letting them reach the page. */
function useKeyRecorder(onDone: (keys: RecordedKey[]) => void) {
  const [recording, setRecording] = React.useState(false);
  const done = React.useRef(onDone);
  done.current = onDone;
  React.useEffect(() => {
    if (!recording) return;
    const keys: RecordedKey[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      setRecording(false);
      done.current(keys);
    };
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') return;
      event.preventDefault();
      event.stopPropagation();
      keys.push({ key: event.key, code: event.code, shift: event.shiftKey, at: event.timeStamp });
      clearTimeout(timer);
      // Terminator ends the burst; otherwise a pause far longer than any wedge gap does.
      if ((event.key === 'Enter' || event.key === 'Tab') && keys.length > 4) finish();
      else timer = setTimeout(finish, 1000);
    };
    window.addEventListener('keydown', listener, { capture: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', listener, { capture: true });
    };
  }, [recording]);
  return { recording, start: () => setRecording(true), cancel: () => setRecording(false) };
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            variant={value === option ? 'default' : 'outline'}
            className="touch-operator h-(--operator-target) min-w-(--operator-target) px-4 text-(length:--operator-text)"
            onClick={() => onChange(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-(length:--operator-text)">
        {label}
      </Label>
      <Input
        id={id}
        className="h-(--operator-target) text-(length:--operator-text) md:text-(length:--operator-text)"
        {...props}
      />
      {hint && <p className="text-[0.8em] text-muted-foreground">{hint}</p>}
    </div>
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
  const [result, setResult] = React.useState<CalibrationResult>();
  const recorder = useKeyRecorder((keys) => setResult(calibrate(keys)));
  const scanner = useScanner({ profile: draft, routes, enabled: !recorder.recording });
  const update = (patch: Partial<ScannerProfile>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const validation = scannerProfileSchema.safeParse(draft);
  const textOrUndefined = (value: string) => (value === '' ? undefined : value);

  return (
    <div
      data-slot="scanner-setup"
      className={cn('grid gap-(--operator-gap) lg:grid-cols-2', className)}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-(length:--operator-text-lg)">1 · Calibrate</CardTitle>
          <CardDescription className="text-(length:--operator-text)">
            Press start, then scan this code once. Settings are worked out from what arrives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-(--operator-gap) text-(length:--operator-text)">
          <CalibrationCode />
          <BigAction
            tone={recorder.recording ? 'caution' : 'primary'}
            icon={<Wand2 aria-hidden />}
            label={recorder.recording ? 'Scan the code now…' : 'Start calibration'}
            description={recorder.recording ? 'Tap to cancel' : undefined}
            onAction={recorder.recording ? recorder.cancel : recorder.start}
          />
          {result && (
            <div className="space-y-3" role="status">
              <p className="flex items-center gap-2 text-(length:--operator-text) font-semibold">
                {result.ok ? (
                  <CircleCheck className="size-7 text-op-ok" aria-hidden />
                ) : (
                  <CircleAlert className="size-7 text-op-fault" aria-hidden />
                )}
                {result.ok ? 'Scanner understood' : 'Scanner needs changes'}
              </p>
              <p className="font-mono break-all">{visible(result.decoded)}</p>
              {result.issues.length > 0 && (
                <ul className="list-disc space-y-1 pl-6">
                  {result.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                className="touch-operator h-(--operator-target) w-full text-(length:--operator-text)"
                onClick={() => update(result.suggested)}
              >
                Apply suggested settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-(length:--operator-text-lg)">2 · Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-(--operator-gap) text-(length:--operator-text)">
          <Field
            id="scanner-label"
            label="Name"
            value={draft.label}
            onChange={(event) => update({ label: event.target.value })}
          />
          <Choice
            label="Connection"
            value={draft.transport}
            options={scannerTransports}
            onChange={(transport) => update({ transport })}
          />
          <Choice
            label="Ends with"
            value={draft.terminator}
            options={['Enter', 'Tab', 'none'] as const}
            onChange={(terminator) => update({ terminator })}
          />
          <Choice
            label="Scanner keyboard layout"
            value={draft.scannerLayout}
            options={keyboardLayouts}
            onChange={(scannerLayout) => update({ scannerLayout })}
          />
          <div className="grid gap-(--operator-gap) sm:grid-cols-3">
            <Field
              id="scanner-prefix"
              label="Prefix"
              value={draft.prefix ?? ''}
              onChange={(event) => update({ prefix: textOrUndefined(event.target.value) })}
            />
            <Field
              id="scanner-suffix"
              label="Suffix"
              value={draft.suffix ?? ''}
              onChange={(event) => update({ suffix: textOrUndefined(event.target.value) })}
            />
            <Field
              id="scanner-gap"
              label="Key gap (ms)"
              inputMode="numeric"
              value={String(draft.maxGapMs)}
              onChange={(event) => update({ maxGapMs: Number(event.target.value) || 0 })}
            />
          </div>
          <Choice
            label="AIM symbology identifiers"
            value={draft.aimIds ? 'on' : 'off'}
            options={['on', 'off'] as const}
            onChange={(value) => update({ aimIds: value === 'on' })}
          />
          {!validation.success && (
            <p role="alert" className="text-op-fault">
              {validation.error.issues
                .map((issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`)
                .join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-(length:--operator-text-lg)">3 · Test and save</CardTitle>
          <CardDescription className="text-(length:--operator-text)">
            Scan real labels. Each scan is decoded with the profile above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-(--operator-gap) text-(length:--operator-text)">
          {draft.transport !== 'wedge' && (
            <Button
              type="button"
              variant="outline"
              className="touch-operator h-(--operator-target) text-(length:--operator-text)"
              onClick={() => void scanner.connect()}
            >
              <Plug className="size-7" aria-hidden />
              {scanner.connected ? 'Reconnect scanner' : 'Connect scanner'}
            </Button>
          )}
          {scanner.error && <p className="text-op-fault">{scanner.error}</p>}
          {scanner.last ? (
            <div className="space-y-2 rounded-lg border-2 p-4">
              <p className="flex flex-wrap items-center gap-2">
                <ScanLine className="size-6" aria-hidden />
                <span className="font-mono text-(length:--operator-text-lg) break-all">
                  {visible(scanner.last.scan.data)}
                </span>
                {scanner.last.scan.symbology && (
                  <Badge variant="outline">{scanner.last.scan.symbology}</Badge>
                )}
                {scanner.last.scan.aimId && (
                  <Badge variant="outline">{scanner.last.scan.aimId}</Badge>
                )}
                {scanner.last.routed && <Badge>{scanner.last.routed.intent}</Badge>}
              </p>
              {scanner.last.scan.gs1 && (
                <table className="w-full text-left">
                  <tbody>
                    {scanner.last.scan.gs1.elements.map((element, index) => (
                      <tr key={`${element.ai}-${index}`} className="border-t">
                        <th scope="row" className="py-1 pr-4 font-mono">
                          ({element.ai})
                        </th>
                        <td className="py-1 pr-4 text-muted-foreground">{element.title}</td>
                        <td className="py-1 font-mono">
                          {element.value}
                          {element.issue && (
                            <span className="ml-3 font-sans text-op-fault">{element.issue}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {scanner.last.scan.gs1 && !scanner.last.scan.gs1.valid && (
                <p className="text-op-fault">
                  {scanner.last.scan.gs1.error ?? 'A GS1 field failed its check.'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No scan yet.</p>
          )}
          {changedElsewhere && edited && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-op-attention p-3"
            >
              <span>The saved profile changed since you started editing.</span>
              <Button type="button" variant="outline" onClick={load}>
                Load saved profile
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-(--operator-gap)">
            <BigAction
              className="sm:w-auto sm:min-w-64"
              label="Save profile"
              pending={pending}
              disabled={!validation.success}
              onAction={() => validation.success && onSave(validation.data, base.revision)}
            />
            {onRemove && (
              <BigAction
                className="sm:w-auto"
                tone="negative"
                size="compact"
                hold
                label="Remove scanner"
                pending={pending}
                onAction={() => onRemove(draft.id)}
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
        </CardContent>
      </Card>
    </div>
  );
}

export { ScannerSetup, CalibrationCode };
