/**
 * Keypad entry rules, kept pure so they can be tested and reused with any input surface. Values
 * stay strings while editing (so "12," or "-0" are representable) and are parsed once on submit.
 */
export interface EntryRules {
  /** Maximum digits after the separator; 0 forbids a separator. */
  readonly decimals?: number;
  readonly allowNegative?: boolean;
  /** Separator shown and typed; the parsed value accepts both. */
  readonly separator?: '.' | ',';
  readonly maxLength?: number;
}

/** Apply one key (`0`–`9`, `.`/`,`, `Backspace`, `Escape`, `±`) to an entry string. */
export function applyKey(value: string, key: string, rules: EntryRules = {}): string {
  const { decimals, allowNegative = false, separator = '.', maxLength = 12 } = rules;
  if (key === 'Backspace') return value.slice(0, -1);
  if (key === 'Escape' || key === 'Clear') return '';
  if (key === '±' || key === '-') {
    if (!allowNegative) return value;
    return value.startsWith('-') ? value.slice(1) : `-${value}`;
  }
  const body = value.replace('-', '');
  if (key === '.' || key === ',') {
    if (decimals === 0 || body.includes(separator)) return value;
    return `${value}${body === '' ? '0' : ''}${separator}`;
  }
  if (!/^\d$/.test(key) || body.length >= maxLength) return value;
  const [, fraction] = body.split(separator);
  if (fraction !== undefined && decimals !== undefined && fraction.length >= decimals) return value;
  // No leading zeros before other digits: "0" then "5" becomes "5".
  if (body === '0') return `${value.startsWith('-') ? '-' : ''}${key}`;
  return `${value}${key}`;
}

/** Parse an entry; undefined while incomplete or empty. Accepts either separator. */
export function parseEntry(value: string): number | undefined {
  if (!/^-?\d+([.,]\d+)?$/.test(value)) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface Tolerance {
  readonly lower?: number;
  readonly upper?: number;
  readonly target?: number;
}
/** Where a value falls against its tolerance, and its position on a gauge (0–100, 50 = target). */
export function toleranceState(
  value: number | undefined,
  tolerance: Tolerance,
): { readonly inside?: boolean; readonly position?: number } {
  if (value === undefined) return {};
  const { lower, upper } = tolerance;
  const inside = (lower === undefined || value >= lower) && (upper === undefined || value <= upper);
  if (lower === undefined || upper === undefined || upper <= lower) return { inside };
  // The tolerance band fills the middle half of the gauge.
  const span = upper - lower;
  const position = Math.min(100, Math.max(0, ((value - (lower - span / 2)) / (span * 2)) * 100));
  return { inside, position };
}
