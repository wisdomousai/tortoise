/**
 * The lines of a source file between `// #region <name>` and `// #endregion <name>`, for a page
 * that shows part of an example file. The markers stay in the example so the excerpt follows
 * the code; an unknown name fails the build.
 */
export function region(source: string, name: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
  const end = lines.findIndex((line) => line.trim() === `// #endregion ${name}`);
  if (start < 0 || end < start) throw new Error(`No region "${name}" in the source`);
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  return body.map((line) => line.slice(indent)).join('\n');
}
