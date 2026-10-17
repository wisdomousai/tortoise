/**
 * JSON as Prettier writes a `.json` file at `width` columns: objects expanded, an array on one
 * line when it fits there (with the comma that follows it) and one item per line otherwise.
 */
export function prettierJson(value: unknown, width = 100, indent = '', lead = 0, tail = 0): string {
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      prettierJson(item, width, `${indent}  `, indent.length + 2, 1),
    );
    const flat = `[${items.join(', ')}]`;
    if (!flat.includes('\n') && lead + flat.length + tail <= width) return flat;
    return `[\n${items.map((item) => `${indent}  ${item}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const inner = `${indent}  `;
    const lines = entries.map(([key, item], index) => {
      const prefix = `${inner}${JSON.stringify(key)}: `;
      const comma = index < entries.length - 1 ? 1 : 0;
      return `${prefix}${prettierJson(item, width, inner, prefix.length, comma)}`;
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}
