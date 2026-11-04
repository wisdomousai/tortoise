import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ScanDetector } from '@tortoise/devices/scanner/wedge';

export type CaptureInput = 'keyboard' | 'scanner' | 'instrument' | 'touch';

/**
 * Keyboard-wedge burst detection lives with the other scanner logic in `@tortoise/devices`;
 * it is re-exported here so existing capture screens keep their import.
 */
export { ScanDetector } from '@tortoise/devices/scanner/wedge';

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Observe keyboard-wedge scans. Scans typed into a focused field are only classified (the
 * field already holds the code), so the station can tag the datapoint's input channel. Scans
 * with no field focused call `onScan`, for example to open the scanned lot.
 */
export function useScannerInput(options: {
  onScan?: (code: string) => void;
  enabled?: boolean;
  maxGapMs?: number;
}) {
  const [lastInput, setLastInput] = useState<CaptureInput>('keyboard');
  const onScan = useRef(options.onScan);
  onScan.current = options.onScan;
  useEffect(() => {
    if (options.enabled === false) return;
    const detector = new ScanDetector({ maxGapMs: options.maxGapMs });
    const listener = (event: KeyboardEvent) => {
      const result = detector.push(event.key, event.timeStamp);
      if (result?.kind === 'scan') {
        setLastInput('scanner');
        if (!editable(event.target)) {
          event.preventDefault();
          onScan.current?.(result.code);
        }
      } else if (result?.kind === 'typing') setLastInput('keyboard');
    };
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, [options.enabled, options.maxGapMs]);
  return { lastInput, markTouch: useCallback(() => setLastInput('touch'), []) };
}

/**
 * Time from "ready to capture" to commit: the number the capture economics depend on. Starts
 * when `itemKey` changes (the station shows the next sample) and is read when submitting.
 */
export function useCaptureTiming(itemKey: string | undefined) {
  const started = useRef<number | undefined>(undefined);
  useEffect(() => {
    started.current = itemKey === undefined ? undefined : performance.now();
  }, [itemKey]);
  return useCallback(
    () =>
      started.current === undefined
        ? undefined
        : Math.min(3_600_000, Math.max(0, Math.round(performance.now() - started.current))),
    [],
  );
}

/**
 * Submit-and-advance: whenever the worklist moves to a new item, focus the capture field and
 * restart timing. Pair with a form that resets on commit so the next value starts empty.
 */
export function useCaptureLoop(
  itemKey: string | undefined,
  focus: RefObject<HTMLInputElement | HTMLElement | null>,
) {
  const elapsed = useCaptureTiming(itemKey);
  useEffect(() => {
    if (itemKey === undefined) return;
    const element = focus.current;
    element?.focus();
    if (element instanceof HTMLInputElement) element.select();
  }, [itemKey, focus]);
  return { elapsed };
}
