import { GROUP_SEPARATOR } from './gs1';
import { characterFor, isDeadKey, keyFor, keyboardLayouts, type KeyboardLayout } from './layouts';
import type { ScannerProfile } from './profile';
import { parseAim } from './symbology';

/**
 * Calibration content, printed as a Code 128 symbol by the setup screen. It contains the characters
 * that break most often on keyboard-wedge scanners: `y`/`z` (QWERTZ swap), punctuation on shifted
 * keys and an ASCII 29 group separator that many wedge configurations silently drop. The markers
 * locate any prefix or suffix the scanner adds.
 */
export const CALIBRATION_BODY = 'yzYZ-./:+%$#@&_=?!';
export const CALIBRATION_CODE = `CAL1${CALIBRATION_BODY}${GROUP_SEPARATOR}END`;

export interface RecordedKey {
  readonly key: string;
  readonly code?: string;
  readonly shift?: boolean;
  /** Event time stamp in milliseconds. */
  readonly at: number;
}
export interface CalibrationResult {
  /** Settings inferred from the recording, ready to merge into a profile. */
  readonly suggested: Pick<ScannerProfile, 'terminator' | 'maxGapMs' | 'aimIds' | 'scannerLayout'> &
    Partial<Pick<ScannerProfile, 'prefix' | 'suffix' | 'groupSeparator'>>;
  /** Decoded text with the suggested layout. */
  readonly decoded: string;
  /** Human-readable problems that settings cannot fix; empty when the scan round-trips. */
  readonly issues: readonly string[];
  readonly ok: boolean;
}

function decode(keys: readonly RecordedKey[], layout: KeyboardLayout): string {
  return keys
    .map(
      (key) =>
        (key.code ? characterFor(layout, key.code, key.shift ?? false) : undefined) ??
        (key.key.length === 1 ? key.key : ''),
    )
    .join('');
}
const score = (text: string) =>
  [...`CAL1${CALIBRATION_BODY}END`].filter((character) => text.includes(character)).length +
  (text.includes(`CAL1${CALIBRATION_BODY}`) ? 100 : 0);

/** Infer scanner settings from the key events produced by scanning `CALIBRATION_CODE` once. */
export function calibrate(recording: readonly RecordedKey[]): CalibrationResult {
  const issues: string[] = [];
  const keys = [...recording];
  let terminator: ScannerProfile['terminator'] = 'none';
  const last = keys.at(-1)?.key;
  if (last === 'Enter' || last === 'Tab') {
    terminator = last;
    keys.pop();
  }
  // Group separators can arrive as a control key event; keep them as ASCII 29.
  const characters = keys.map((key) =>
    key.key === 'Unidentified' && !key.code ? { ...key, key: GROUP_SEPARATOR } : key,
  );
  const gaps = characters.slice(1).map((key, index) => key.at - characters[index]!.at);
  const maxGapMs = Math.min(200, Math.max(15, Math.ceil(Math.max(0, ...gaps) * 1.5) + 5));
  if (gaps.some((gap) => gap > 60))
    issues.push('Keys arrived slowly; the scanner may be in a delayed-transmission mode.');

  const layout = keyboardLayouts.reduce((best, candidate) =>
    score(decode(characters, candidate)) > score(decode(characters, best)) ? candidate : best,
  );
  const decoded = decode(characters, layout);
  const start = decoded.indexOf('CAL1');
  const end = decoded.lastIndexOf('END');
  if (start < 0 || end < start) {
    return {
      suggested: { terminator, maxGapMs, aimIds: false, scannerLayout: layout },
      decoded,
      issues: [...issues, 'The calibration markers were not recognized. Scan the code again.'],
      ok: false,
    };
  }
  const { aim, data: prefix } = parseAim(decoded.slice(0, start));
  const suffix = decoded.slice(end + 3);
  const body = decoded.slice(start + 4, end);
  const expected = CALIBRATION_BODY;
  const received = body.slice(0, expected.length);
  for (let index = 0; index < expected.length; index++)
    if (received[index] !== expected[index])
      issues.push(
        `"${expected[index]}" arrives as "${received[index] ?? ''}". Configure the scanner for a US keyboard layout.`,
      );
  const separator = body.slice(expected.length);
  let groupSeparator: string | undefined;
  if (separator === '')
    issues.push(
      'The group separator (ASCII 29) is lost. Configure the scanner to send a substitute character, then calibrate again.',
    );
  else if (separator !== GROUP_SEPARATOR) groupSeparator = separator;
  if (!aim)
    issues.push(
      'No AIM symbology identifier. Enable it so GS1 labels are recognized reliably (optional).',
    );
  const blocking = issues.filter((issue) => !issue.endsWith('(optional).'));
  return {
    suggested: {
      terminator,
      maxGapMs,
      aimIds: aim !== undefined,
      scannerLayout: layout,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
      ...(groupSeparator ? { groupSeparator } : {}),
    },
    decoded,
    issues,
    ok: blocking.length === 0,
  };
}

/** Key events a scanner configured for `layout` produces for `text`; used by tests and demos. */
export function simulateWedge(
  text: string,
  layout: KeyboardLayout,
  host: KeyboardLayout,
  options: {
    readonly startAt?: number;
    readonly gapMs?: number;
    readonly terminator?: string;
  } = {},
): RecordedKey[] {
  const keys: RecordedKey[] = [];
  let at = options.startAt ?? 0;
  for (const character of text) {
    const key = keyFor(layout, character);
    at += options.gapMs ?? 4;
    if (!key) {
      keys.push({ key: character === GROUP_SEPARATOR ? 'Unidentified' : character, at });
      continue;
    }
    const typed = characterFor(host, key.code, key.shift);
    keys.push({
      // Browsers report a dead key as "Dead"; only the physical code survives.
      key: typed === undefined || isDeadKey(host, typed) ? 'Dead' : typed,
      code: key.code,
      shift: key.shift,
      at,
    });
  }
  if (options.terminator !== '') keys.push({ key: options.terminator ?? 'Enter', at: at + 4 });
  return keys;
}
