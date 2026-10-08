import type { OutputOf } from '@agent-native/contracts';
import type { operations } from '../../contracts';

export type LotDetail = OutputOf<typeof operations.lotGet>;
export type CodeGroups = OutputOf<typeof operations.codeList>['groups'];
export type Characteristic = LotDetail['characteristics'][number];
/** One sample of one characteristic: the unit of capture. */
export type Target = { characteristicId: string; sample: number };

export const format = (value: number, decimals?: number) =>
  decimals === undefined ? String(value) : value.toFixed(decimals);

/** The specification limits in the rail, for example `· 219.90–220.10` or `· ≤ 0.05`. */
export function spec({ kind, lower, upper, decimals }: Characteristic) {
  if (kind === 'qualitative') return ' · code';
  if (lower !== undefined && upper !== undefined)
    return ` · ${format(lower, decimals)}–${format(upper, decimals)}`;
  if (upper !== undefined) return ` · ≤ ${format(upper, decimals)}`;
  if (lower !== undefined) return ` · ≥ ${format(lower, decimals)}`;
  return '';
}
