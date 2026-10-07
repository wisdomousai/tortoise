/**
 * AIM symbology identifiers (ISO/IEC 15424): `]` + code character + modifier, prepended by a
 * scanner configured to transmit them. They tell the application which symbology was read and,
 * for several codes, that the data is a GS1 element string. Enabling them is the only reliable way
 * to tell a GS1-128 label from a plain Code 128 label that happens to start with digits.
 */
export type Symbology =
  | 'code128'
  | 'gs1-128'
  | 'datamatrix'
  | 'gs1-datamatrix'
  | 'qr'
  | 'gs1-qr'
  | 'ean-13'
  | 'ean-8'
  | 'upc-a'
  | 'code39'
  | 'itf'
  | 'gs1-databar'
  | 'pdf417'
  | 'aztec'
  | 'unknown';

export interface AimIdentifier {
  readonly id: string;
  readonly symbology: Symbology;
  /** The symbology carries a GS1 element string. */
  readonly gs1: boolean;
}

function classify(code: string, modifier: string): { symbology: Symbology; gs1: boolean } {
  switch (code) {
    case 'C':
      return modifier === '1'
        ? { symbology: 'gs1-128', gs1: true }
        : { symbology: 'code128', gs1: false };
    case 'd':
      return modifier === '2' || modifier === '5'
        ? { symbology: 'gs1-datamatrix', gs1: true }
        : { symbology: 'datamatrix', gs1: false };
    case 'Q':
      return modifier === '3' || modifier === '4'
        ? { symbology: 'gs1-qr', gs1: true }
        : { symbology: 'qr', gs1: false };
    case 'E':
      return modifier === '4'
        ? { symbology: 'ean-8', gs1: false }
        : { symbology: 'ean-13', gs1: false };
    case 'A':
      return { symbology: 'code39', gs1: false };
    case 'I':
      return { symbology: 'itf', gs1: false };
    case 'e':
      return { symbology: 'gs1-databar', gs1: true };
    case 'L':
      return { symbology: 'pdf417', gs1: false };
    case 'z':
      return { symbology: 'aztec', gs1: modifier === '1' };
    default:
      return { symbology: 'unknown', gs1: false };
  }
}

/** Split a leading AIM identifier from scanned text, when one is present. */
export function parseAim(text: string): { aim?: AimIdentifier; data: string } {
  const match = /^\](.)([0-9A-Za-z])/.exec(text);
  if (!match) return { data: text };
  const [id, code, modifier] = match as unknown as [string, string, string];
  return { aim: { id, ...classify(code, modifier) }, data: text.slice(id.length) };
}

/** Map a W3C BarcodeDetector format name to the same vocabulary. */
export function symbologyFromFormat(format: string): Symbology {
  const formats: Record<string, Symbology> = {
    code_128: 'code128',
    data_matrix: 'datamatrix',
    qr_code: 'qr',
    ean_13: 'ean-13',
    ean_8: 'ean-8',
    upc_a: 'upc-a',
    code_39: 'code39',
    itf: 'itf',
    pdf417: 'pdf417',
    aztec: 'aztec',
  };
  return formats[format] ?? 'unknown';
}
