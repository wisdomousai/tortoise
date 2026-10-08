import { CliText } from './types';

/** Render a value for humans. Snapshot and receipt envelopes show their payload. */
export function formatText(value: unknown): string {
  if (value instanceof CliText) return value.text;
  if (value && typeof value === 'object' && 'text' in value && 'operations' in value)
    return String((value as { text: unknown }).text);
  const payload =
    value && typeof value === 'object' && 'cursor' in value
      ? 'data' in value
        ? value.data
        : 'result' in value
          ? value.result
          : value
      : value;
  const scalar = (item: unknown) =>
    item === null || typeof item !== 'object' ? String(item ?? '') : JSON.stringify(item);
  const rows =
    Array.isArray(payload) && payload.every((item) => item && typeof item === 'object')
      ? (payload as Record<string, unknown>[])
      : payload &&
          typeof payload === 'object' &&
          'items' in payload &&
          Array.isArray((payload as { items: unknown }).items)
        ? ((payload as { items: Record<string, unknown>[] }).items ?? [])
        : undefined;
  if (rows) {
    if (!rows.length) return '(none)';
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) =>
      rows.every((row) => row[column] === null || typeof row[column] !== 'object'),
    );
    const cells = [columns, ...rows.map((row) => columns.map((column) => scalar(row[column])))];
    const widths = columns.map((_, index) => Math.max(...cells.map((row) => row[index]!.length)));
    return cells
      .map((row) =>
        row
          .map((cell, index) => cell.padEnd(widths[index]!))
          .join('  ')
          .trimEnd(),
      )
      .join('\n');
  }
  if (payload && typeof payload === 'object')
    return Object.entries(payload)
      .map(([key, item]) => `${key}: ${scalar(item)}`)
      .join('\n');
  return scalar(payload);
}
