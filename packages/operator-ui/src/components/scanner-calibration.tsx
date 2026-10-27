import * as React from 'react';
import { CircleAlert, CircleCheck, Wand2 } from 'lucide-react';
import {
  CALIBRATION_CODE,
  GROUP_SEPARATOR,
  type CalibrationResult,
  type RecordedKey,
  type ScannerProfile,
} from '@agent-native/devices';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BigAction } from '@/components/big-action';
import { cn } from '@/lib/utils';

export /** Show control characters so a technician can see what the scanner really sent. */
const visible = (text: string) =>
  text.replaceAll(GROUP_SEPARATOR, '⟨GS⟩').replaceAll('\t', '⟨TAB⟩').replaceAll('\r', '⟨CR⟩');

export /** The calibration code as Code 128, which every 1D and 2D scanner reads. */
function CalibrationCode({ className }: { className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    let cancelled = false;
    // The barcode encoder is over 2 MB; load it when the code is first drawn, not with every station.
    void import('bwip-js/browser').then(
      ({ default: bwipjs }) => {
        if (cancelled || !canvas.current) return;
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
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
    return () => {
      cancelled = true;
    };
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

function CalibrationOutcome({
  result,
  onApply,
}: {
  result: CalibrationResult;
  onApply: (suggested: Partial<ScannerProfile>) => void;
}) {
  return (
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
        onClick={() => onApply(result.suggested)}
      >
        Apply suggested settings
      </Button>
    </div>
  );
}

/** Step 1: record one scan of the calibration code and show the settings inferred from it. */
function CalibrationCard({
  recorder,
  result,
  onApply,
}: {
  recorder: ReturnType<typeof useKeyRecorder>;
  result: CalibrationResult | undefined;
  onApply: (suggested: Partial<ScannerProfile>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-(length:--operator-text-lg)">1 · Calibrate</CardTitle>
        <CardDescription className="text-(length:--operator-text)">
          Press start, then scan this code once. Settings are worked out from what the scanner
          sends.
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
        {result && <CalibrationOutcome result={result} onApply={onApply} />}
      </CardContent>
    </Card>
  );
}

export { CalibrationCard, useKeyRecorder };
