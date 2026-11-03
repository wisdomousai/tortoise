import type { Part } from '../contracts/part';

/** Prices are stored in euro cents and shown in euro with two decimals. */
const euroFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
export const euro = (cents: number) => euroFormat.format(cents / 100);

/** A date and time the way the desk reads it during a call. */
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export const when = (epochMs: number) => timeFormat.format(epochMs);

/** The time of day of a message in the assistant panel. */
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
export const clock = (epochMs: number) => clockFormat.format(epochMs);

/** How a stock level reads: none on the shelf, three or fewer, or more. */
export type StockTone = 'destructive' | 'warning' | 'success';
export const stockTone = (stock: number): StockTone =>
  stock === 0 ? 'destructive' : stock <= 3 ? 'warning' : 'success';

/** Classes for a badge in one of the starter's status tokens. */
export const toneClass: Record<StockTone | 'muted', string> = {
  success: 'border-transparent bg-success/10 text-success dark:bg-success/20',
  warning: 'border-transparent bg-warning/10 text-warning dark:bg-warning/20',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

/** The assemblies in the order the lookup lists them; the exploded view places each by grid. */
export const assemblyOrder: readonly Part['assembly'][] = [
  'hv-bushings',
  'lv-bushings',
  'tap-changer',
  'tank-cover',
  'conservator',
  'protection',
];

export const assemblyLabel: Record<Part['assembly'], string> = {
  'hv-bushings': 'HV bushings',
  'lv-bushings': 'LV bushings',
  'tap-changer': 'Tap changer',
  'tank-cover': 'Tank cover',
  conservator: 'Conservator',
  protection: 'Protection',
};

export const categoryLabel: Record<Part['category'], string> = {
  bushing: 'Bushings',
  'tap-changer': 'Tap changer',
  gasket: 'Gaskets',
  relay: 'Relays',
};

/** Parts grouped by assembly in `assemblyOrder`, each group in the order it was given. */
export function byAssembly<T extends Pick<Part, 'assembly'>>(parts: readonly T[]) {
  return assemblyOrder
    .map((assembly) => ({ assembly, parts: parts.filter((part) => part.assembly === assembly) }))
    .filter((group) => group.parts.length > 0);
}
