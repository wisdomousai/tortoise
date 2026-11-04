import { MAX_PAGE, type CollectionPage } from './collection';
import type { DisplayDeclaration } from './display';

/** One CSV column: the record field it reads and the header it shows. */
export interface CsvColumn {
  readonly name: string;
  readonly label: string;
}

/**
 * A spreadsheet treats a text cell that starts with one of these as a formula. Record values come
 * from people, agents and other systems, so such a cell gets a leading apostrophe and opens as
 * text.
 */
const formulaStart = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text: string;
  if (typeof value === 'string') text = formulaStart.test(value) ? `'${value}` : value;
  else if (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object'))
    text = value.join(', ');
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Rows as CSV (RFC 4180): a header row of the labels, then one row per record with CRLF line
 * ends. Dates stay as the ISO text the record holds, so a spreadsheet reads them in any locale.
 */
export function csvText(columns: readonly CsvColumn[], rows: readonly Record<string, unknown>[]) {
  const lines = [columns.map((column) => cell(column.label))];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column.name])));
  return lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
}

/**
 * Every row of a list query, read page by page at the largest page the list takes. The instance
 * scopes, filters and counts each page, so the rows are the ones the caller may read. A page that
 * comes back empty ends the read, so a list that shrinks while it pages still ends.
 */
export async function readAllPages<Item>(
  page: (offset: number, limit: number) => Promise<CollectionPage<Item>>,
): Promise<Item[]> {
  const items: Item[] = [];
  for (;;) {
    const next = await page(items.length, MAX_PAGE);
    items.push(...next.items);
    if (!next.items.length || items.length >= next.total) return items;
  }
}

/**
 * The columns of a list without a screen to name them: the display fields a list declares, else
 * every field the rows have, in the order they first appear.
 */
export function csvColumns(
  display: DisplayDeclaration | undefined,
  rows: readonly Record<string, unknown>[],
): CsvColumn[] {
  if (display?.fields)
    return display.fields.map((field) => ({ name: field.name, label: field.label ?? field.name }));
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].map((name) => ({
    name,
    label: name,
  }));
}
