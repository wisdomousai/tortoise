/**
 * Designation schemes as data: the syntax a reference designation must follow and the class
 * letters or device numbers that give it a readable label. Browser-safe and shared with the field
 * app, so a tag scanned in the field is checked by the same rules the hub applies.
 *
 * The tables are the common entries, not the full standards; an unknown class letter or device
 * number is still valid syntax and simply has no label.
 */
export const schemeIds = ['iec81346', 'kks', 'ansi'] as const;
export type SchemeId = (typeof schemeIds)[number];

export interface Scheme {
  readonly id: SchemeId;
  readonly label: string;
  readonly example: string;
  readonly pattern: RegExp;
  /** A readable label for a valid designation, from its class letters or device numbers. */
  describe(designation: string): string | undefined;
}

/** IEC 81346-2 classes of objects by their main purpose (first letter of a product aspect). */
const iecClasses: Readonly<Record<string, string>> = {
  A: 'two or more purposes',
  B: 'sensing',
  C: 'storing',
  E: 'providing heat or radiation',
  F: 'protecting',
  G: 'generating energy',
  K: 'processing signals',
  M: 'driving',
  P: 'presenting information',
  Q: 'switching',
  R: 'restricting',
  S: 'manual control',
  T: 'converting energy',
  U: 'holding in position',
  W: 'conducting',
  X: 'connecting',
};

/** KKS function key, first letter of the system classification. */
const kksGroups: Readonly<Record<string, string>> = {
  A: 'grid and distribution',
  B: 'power transmission and auxiliary power',
  C: 'instrumentation and control',
  E: 'fuel supply and residue disposal',
  G: 'water supply and disposal',
  H: 'heat generation',
  L: 'steam, water and gas cycles',
  M: 'main machine sets',
  P: 'cooling water',
  Q: 'auxiliary systems',
  U: 'structures',
};

/** IEEE C37.2 device function numbers. */
const ansiDevices: Readonly<Record<string, string>> = {
  '21': 'distance relay',
  '25': 'synchronism check',
  '27': 'undervoltage relay',
  '32': 'directional power relay',
  '46': 'negative sequence relay',
  '49': 'thermal relay',
  '50': 'instantaneous overcurrent relay',
  '51': 'time overcurrent relay',
  '52': 'AC circuit breaker',
  '59': 'overvoltage relay',
  '67': 'directional overcurrent relay',
  '79': 'reclosing relay',
  '81': 'frequency relay',
  '86': 'lockout relay',
  '87': 'differential relay',
  '89': 'line switch',
};

const iec81346: Scheme = {
  id: 'iec81346',
  label: 'IEC 81346',
  example: '=G1-Q1',
  // One or more aspects: `=` function, `-` product, `+` location, each a class code with an
  // optional number, optionally followed by dotted subdivisions.
  pattern: /^(?:[=\-+][A-Z]{1,3}\d{0,4}(?:\.[A-Z]{0,3}\d{1,4})*)+$/,
  describe(designation) {
    const product = /-([A-Z])/.exec(designation)?.[1];
    return product ? iecClasses[product] : undefined;
  },
};

const kks: Scheme = {
  id: 'kks',
  label: 'KKS',
  example: '1LBA10AA101',
  // Plant unit, system (optional prefix digit, three letters, two digits), equipment unit (two
  // letters, three digits) and component (two letters, two digits); spaces between levels allowed.
  pattern: /^[0-9A-Z]?[0-9]?[A-Z]{3}[0-9]{2}(?: ?[A-Z]{2}[0-9]{3}(?: ?[A-Z]{2}[0-9]{2})?)?$/,
  describe(designation) {
    const system = /[A-Z]{3}[0-9]{2}/.exec(designation)?.[0];
    return system ? kksGroups[system[0]!] : undefined;
  },
};

const ansi: Scheme = {
  id: 'ansi',
  label: 'ANSI/IEEE C37.2',
  example: '50/51N',
  // Device numbers 1 to 99 with optional suffix letters, combined with `/`.
  pattern: /^(?:[1-9][0-9]?[A-Z]{0,3})(?:\/[1-9][0-9]?[A-Z]{0,3})*$/,
  describe(designation) {
    const names = designation
      .split('/')
      .map((part) => ansiDevices[/^\d+/.exec(part)![0]])
      .filter((name): name is string => !!name);
    return names.length ? names.join(', ') : undefined;
  },
};

export const schemes: Readonly<Record<SchemeId, Scheme>> = { iec81346, kks, ansi };

/** Upper-case and trim a designation the way it is stored and compared. */
export const normalizeDesignation = (designation: string) =>
  designation.trim().toUpperCase().replace(/\s+/g, ' ');

/** The reason a designation does not follow its scheme, or undefined when it does. */
export function designationProblem(scheme: SchemeId, designation: string): string | undefined {
  const rule = schemes[scheme];
  return rule.pattern.test(normalizeDesignation(designation))
    ? undefined
    : `${designation} is not a ${rule.label} designation (for example ${rule.example})`;
}
