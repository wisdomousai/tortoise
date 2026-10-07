/**
 * GS1 element-string parsing for scanned GS1-128, GS1 DataMatrix, GS1 QR and DataBar labels, plus
 * the human-readable `(01)…(10)…` form. Fixed-length application identifiers (AIs) run on without a
 * separator; variable-length ones end at a group separator (ASCII 29, FNC1 in the symbol) or at the
 * end of the data. Keyboard-wedge scanners frequently drop ASCII 29, so the scanner profile can name
 * a substitute character that the decoder converts back before parsing.
 *
 * The table covers AIs common at receiving, production and shipping stations. Unknown AIs with a
 * known prefix length are still parsed as variable-length text and marked without a title.
 */
export const GROUP_SEPARATOR = '\u001d';

export interface Gs1Element {
  readonly ai: string;
  readonly value: string;
  readonly title?: string;
  /** Implied decimal places for measure AIs such as 310n (net weight, kg). */
  readonly decimals?: number;
  /** Numeric value with decimals applied, for measure and count AIs. */
  readonly numeric?: number;
  /** Present when a check digit, date or length rule fails. */
  readonly issue?: string;
}
export interface Gs1Result {
  readonly elements: readonly Gs1Element[];
  /** Keyed by AI; the last occurrence wins. */
  readonly values: Readonly<Record<string, string>>;
  readonly valid: boolean;
  /** Set when the data could not be split into elements at all. */
  readonly error?: string;
}

/** Length of the AI itself, from its first two digits (GS1 General Specifications). */
function aiLength(prefix: number): number | undefined {
  if (prefix <= 22 || prefix === 30 || prefix === 37 || prefix >= 90) return 2;
  if ([23, 24, 25, 40, 41, 42].includes(prefix)) return 3;
  if ((prefix >= 31 && prefix <= 36) || prefix === 39 || prefix === 43) return 4;
  if ((prefix >= 70 && prefix <= 72) || (prefix >= 80 && prefix <= 82)) return 4;
  return undefined;
}
/** Data length of AIs with a predefined length; these are never followed by a separator. */
const fixedData: Readonly<Record<number, number>> = {
  0: 18,
  1: 14,
  2: 14,
  3: 14,
  4: 16,
  11: 6,
  12: 6,
  13: 6,
  14: 6,
  15: 6,
  16: 6,
  17: 6,
  18: 6,
  19: 6,
  20: 2,
  31: 6,
  32: 6,
  33: 6,
  34: 6,
  35: 6,
  36: 6,
  41: 13,
};
const variableMax: Readonly<Record<string, number>> = {
  '10': 20,
  '21': 20,
  '22': 20,
  '240': 30,
  '241': 30,
  '250': 30,
  '251': 30,
  '30': 8,
  '37': 8,
  '400': 30,
  '401': 30,
  '403': 30,
  '420': 20,
  '421': 12,
  '422': 3,
  '7003': 10,
  '8004': 30,
  '90': 30,
};
const titles: Readonly<Record<string, string>> = {
  '00': 'SSCC',
  '01': 'GTIN',
  '02': 'CONTENT',
  '10': 'BATCH/LOT',
  '11': 'PROD DATE',
  '13': 'PACK DATE',
  '15': 'BEST BEFORE',
  '17': 'USE BY',
  '20': 'VARIANT',
  '21': 'SERIAL',
  '240': 'ADDITIONAL ID',
  '241': 'CUST. PART No.',
  '250': 'SECONDARY SERIAL',
  '30': 'VAR. COUNT',
  '37': 'COUNT',
  '400': 'ORDER NUMBER',
  '401': 'GINC',
  '410': 'SHIP TO LOC',
  '414': 'LOC No.',
  '420': 'SHIP TO POST',
  '422': 'ORIGIN',
  '7003': 'EXPIRY TIME',
  '8004': 'GIAI',
  '90': 'INTERNAL',
};
const measureTitles: Readonly<Record<string, string>> = {
  '310': 'NET WEIGHT (kg)',
  '311': 'LENGTH (m)',
  '312': 'WIDTH (m)',
  '313': 'HEIGHT (m)',
  '315': 'NET VOLUME (l)',
  '330': 'GROSS WEIGHT (kg)',
};

/** GS1 mod-10 check digit over all but the last digit. */
export function gs1CheckDigitValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let index = 0; index < body.length; index++)
    sum += Number(body[body.length - 1 - index]) * (index % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function validDate(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  // Day 00 means the last day of the month.
  return month >= 1 && month <= 12 && day <= 31;
}

/** Length rule for an AI's data, shared by the raw and bracketed syntaxes. */
function lengthIssue(ai: string, prefix: number, value: string): string | undefined {
  const fixed = fixedData[prefix];
  if (fixed !== undefined)
    return value.length === fixed ? undefined : `AI ${ai} needs ${fixed} characters`;
  const max = variableMax[ai] ?? 90;
  return value.length === 0 || value.length > max ? `Length must be 1 to ${max}` : undefined;
}

function element(ai: string, value: string): Gs1Element {
  const prefix = Number(ai.slice(0, 2));
  // A length issue wins: the content rules below assume the declared length.
  let issue = lengthIssue(ai, prefix, value);
  let decimals: number | undefined;
  let numeric: number | undefined;
  if (['00', '01', '02', '03'].includes(ai) || (prefix === 41 && ai.length === 3)) {
    if (!gs1CheckDigitValid(value)) issue ??= 'Check digit mismatch';
  } else if (prefix >= 11 && prefix <= 17 && !validDate(value)) issue ??= 'Invalid date';
  if ((prefix >= 31 && prefix <= 36) || ai.startsWith('392')) {
    decimals = Number(ai.at(-1));
    if (/^\d+$/.test(value)) numeric = Number(value) / 10 ** decimals;
    else issue ??= 'Expected digits';
  } else if ((ai === '30' || ai === '37') && /^\d+$/.test(value)) numeric = Number(value);
  const title = titles[ai] ?? (ai.length === 4 ? measureTitles[ai.slice(0, 3)] : undefined);
  return {
    ai,
    value,
    ...(title ? { title } : {}),
    ...(decimals === undefined ? {} : { decimals }),
    ...(numeric === undefined ? {} : { numeric }),
    ...(issue ? { issue } : {}),
  };
}

function result(elements: Gs1Element[], error?: string): Gs1Result {
  const values: Record<string, string> = {};
  for (const item of elements) values[item.ai] = item.value;
  return {
    elements,
    values,
    valid: !error && elements.length > 0 && elements.every((item) => !item.issue),
    ...(error ? { error } : {}),
  };
}

/** Parse the human-readable form `(01)09506000134352(17)201225(10)ABC123`. */
function parseBracketed(text: string): Gs1Result {
  const elements: Gs1Element[] = [];
  const pattern = /\((\d{2,4})\)([^(]*)/g;
  let consumed = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index !== consumed) return result(elements, 'Unexpected text between elements');
    elements.push(element(match[1]!, match[2]!));
    consumed = match.index + match[0].length;
  }
  return consumed === text.length ? result(elements) : result(elements, 'Trailing text');
}

/** Parse a GS1 element string whose variable-length fields end at ASCII 29. */
export function parseGs1(data: string): Gs1Result {
  if (data.startsWith('(')) return parseBracketed(data);
  const elements: Gs1Element[] = [];
  let position = data.startsWith(GROUP_SEPARATOR) ? 1 : 0;
  while (position < data.length) {
    const prefix = Number(data.slice(position, position + 2));
    const length = /^\d\d$/.test(data.slice(position, position + 2)) ? aiLength(prefix) : undefined;
    if (length === undefined)
      return result(elements, `Unknown application identifier at position ${position}`);
    const ai = data.slice(position, position + length);
    if (!/^\d+$/.test(ai) || ai.length !== length)
      return result(elements, `Truncated application identifier at position ${position}`);
    position += length;
    const fixed = fixedData[prefix];
    if (fixed !== undefined) {
      const value = data.slice(position, position + fixed);
      if (value.length !== fixed || value.includes(GROUP_SEPARATOR))
        return result(elements, `AI ${ai} needs ${fixed} characters`);
      elements.push(element(ai, value));
      position += fixed;
      // Some encoders emit a redundant separator after fixed fields; it is harmless.
      if (data[position] === GROUP_SEPARATOR) position++;
      continue;
    }
    const end = data.indexOf(GROUP_SEPARATOR, position);
    const value = data.slice(position, end < 0 ? data.length : end);
    elements.push(element(ai, value));
    position = end < 0 ? data.length : end + 1;
  }
  return result(elements);
}

/** Cheap pre-check for routing: does this look like a GS1 element string? */
export function looksLikeGs1(data: string): boolean {
  return data.startsWith('(') ? /^\(\d{2,4}\)/.test(data) : parseGs1(data).valid;
}
