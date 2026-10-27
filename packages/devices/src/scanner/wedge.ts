import { decodeScan } from './decode';
import { characterFor, type KeyboardLayout } from './layouts';
import { defaultWedgeProfile, type ScannerProfile } from './profile';
import { ScannerUnsupported, type ScannerSource } from './source';

/** A key as the wedge sees it: `key` from the host layout, `code` the physical position. */
export interface WedgeKey {
  readonly key: string;
  readonly code?: string;
  readonly shift?: boolean;
}

/**
 * Distinguishes a keyboard-wedge burst (barcode scanner, digital gauge) from typing. Wedge devices
 * emit a whole code within a few milliseconds per key and finish with a terminator; people type far
 * slower. With a `scannerLayout`, characters come from the physical key code through the scanner's
 * layout, so a US-configured scanner reads correctly on a Swiss or German host, dead keys included.
 * Pure and clock-injected so it is deterministic in tests.
 */
export class ScanDetector {
  private buffer = '';
  private last = -Infinity;
  constructor(
    private readonly options: {
      /** Longest gap between keys inside a burst. */
      readonly maxGapMs?: number;
      readonly minLength?: number;
      readonly terminator?: string;
      readonly scannerLayout?: KeyboardLayout;
    } = {},
  ) {}
  /** Feed one key. Returns the code when a terminator completes a burst. */
  push(
    input: string | WedgeKey,
    at: number,
  ): { kind: 'scan'; code: string } | { kind: 'typing' } | undefined {
    const { key, code, shift } = typeof input === 'string' ? { key: input } : input;
    const { maxGapMs = 35, terminator = 'Enter' } = this.options;
    if (key === terminator) return this.flush();
    const character =
      (this.options.scannerLayout && code
        ? characterFor(this.options.scannerLayout, code, shift ?? false)
        : undefined) ?? (key.length === 1 ? key : undefined);
    if (character === undefined) return undefined;
    // A pause longer than any wedge gap ends what came before: earlier keys were typing (a hotkey,
    // a slowly typed value), and this key may start a scan. Keeping them would misclassify the
    // next scan as typing.
    if (this.buffer && at - this.last > maxGapMs) this.buffer = '';
    this.buffer += character;
    this.last = at;
    return undefined;
  }
  /** Complete the current burst without a terminator key, for scanners configured without one. */
  flush(): { kind: 'scan'; code: string } | { kind: 'typing' } | undefined {
    const burst = this.buffer.length >= (this.options.minLength ?? 3);
    const value = this.buffer;
    this.reset();
    return burst ? { kind: 'scan', code: value } : value ? { kind: 'typing' } : undefined;
  }
  reset(): void {
    this.buffer = '';
    this.last = -Infinity;
  }
}

const editable = (target: EventTarget | null) =>
  typeof HTMLElement !== 'undefined' &&
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Keyboard-wedge source over DOM key events. Scans typed into a focused field are reported but not
 * intercepted (the field already holds the characters); scans with no field focused are
 * intercepted so their Enter does not activate a focused button.
 */
export function createWedgeSource(
  profile: ScannerProfile = defaultWedgeProfile(),
  target:
    Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined = typeof window ===
  'undefined'
    ? undefined
    : window,
): ScannerSource {
  return {
    transport: 'wedge',
    profile,
    isSupported: () => target !== undefined,
    async start({ onScan }) {
      if (!target) throw new ScannerUnsupported('wedge', 'no keyboard event target');
      const detector = new ScanDetector({
        maxGapMs: profile.maxGapMs,
        minLength: profile.minLength,
        terminator: profile.terminator === 'none' ? '\u0000' : profile.terminator,
        scannerLayout: profile.scannerLayout,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const emit = (code: string, at: number) => onScan(decodeScan(code, profile, { at }));
      const listener = (event: Event) => {
        const key = event as KeyboardEvent;
        const result = detector.push(
          { key: key.key, code: key.code, shift: key.shiftKey },
          key.timeStamp,
        );
        if (profile.terminator === 'none') {
          // Without a terminator a burst ends when the timer after the last key fires.
          clearTimeout(timer);
          const at = key.timeStamp;
          timer = setTimeout(() => {
            const flushed = detector.flush();
            if (flushed?.kind === 'scan') emit(flushed.code, at);
          }, profile.maxGapMs * 2);
          return;
        }
        if (result?.kind !== 'scan') return;
        if (!editable(key.target)) key.preventDefault();
        emit(result.code, key.timeStamp);
      };
      target.addEventListener('keydown', listener, { capture: true });
      return () => {
        clearTimeout(timer);
        target.removeEventListener('keydown', listener, { capture: true });
      };
    },
  };
}
