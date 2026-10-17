/**
 * Generated applications keep `// scaffold:<list>` comments inside the arrays and objects that
 * `scaffold add` extends: operations, handlers, policy rules, routes. Each insertion goes on the
 * lines before the marker, at the marker's indentation, so the marker stays last and a second
 * `add` extends the same list. Code without the marker is never edited.
 */
export function insertAtMarker(source: string, marker: string, lines: readonly string[]): string {
  const pattern = new RegExp(`^([ \\t]*)// scaffold:${marker}$`, 'm');
  const match = pattern.exec(source);
  if (!match) throw new Error(`Missing "// scaffold:${marker}" marker; add it where ${marker} go`);
  const indent = match[1]!;
  const block = lines.map((line) => (line ? `${indent}${line}` : line)).join('\n');
  return `${source.slice(0, match.index)}${block}\n${source.slice(match.index)}`;
}

/**
 * Apply several marker insertions to one file. A line the file already holds verbatim, such as
 * a shared import, is not inserted twice.
 */
export function extend(
  source: string,
  insertions: Readonly<Record<string, readonly string[]>>,
): string {
  return Object.entries(insertions).reduce((text, [marker, lines]) => {
    const present = new Set(text.split('\n').map((line) => line.trim()));
    const fresh = lines.filter((line) => !line.startsWith('import ') || !present.has(line));
    return fresh.length ? insertAtMarker(text, marker, fresh) : text;
  }, source);
}
