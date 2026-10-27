/** A content workspace generated into an export instead of copied from the source. */
export interface GeneratedContent {
  /** Workspace directory, for example `showcase/examples/field-notes`. */
  readonly directory: string;
  readonly packageName: string;
  /** File contents by path relative to `directory`. */
  readonly files: Readonly<Record<string, string>>;
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Insert `entry` among the lines from `start` to the first line at `end` indentation, before
 * the first line whose key (captured by `key`) sorts after `name`. Bun writes these sections in
 * code-point order, so the result reads as if Bun had written it.
 */
function insertSorted(
  lines: string[],
  start: number,
  end: RegExp,
  key: RegExp,
  name: string,
  entry: readonly string[],
): void {
  let index = start + 1;
  for (; index < lines.length && !end.test(lines[index]!); index++) {
    const match = key.exec(lines[index]!);
    if (match && match[1] && byCode(match[1], name) > 0) break;
  }
  lines.splice(index, 0, ...entry);
}

function lineOf(lines: readonly string[], pattern: RegExp, from = 0): number {
  const index = lines.findIndex((line, position) => position >= from && pattern.test(line));
  if (index < 0) throw new Error(`Lockfile has no line matching ${pattern}`);
  return index;
}

/**
 * Add a workspace to Bun's text lockfile: the root's `workspace:*` dependency, the workspace
 * entry and its package entry. The export then installs with `--frozen-lockfile` like the source.
 */
export function addWorkspace(content: string, workspace: GeneratedContent): string {
  const { directory, packageName } = workspace;
  const lines = content.split('\n');
  const root = lineOf(lines, /^ {4}"": \{$/);
  const dependencies = lineOf(lines, /^ {6}"dependencies": \{$/, root);
  insertSorted(lines, dependencies, /^ {6}\}/, /^ {8}"([^"]+)":/, packageName, [
    `        "${packageName}": "workspace:*",`,
  ]);
  const workspaces = lineOf(lines, /^ {2}"workspaces": \{$/);
  insertSorted(lines, workspaces, /^ {2}\}/, /^ {4}"([^"]+)": \{$/, directory, [
    `    "${directory}": {`,
    `      "name": "${packageName}",`,
    '      "version": "0.1.0",',
    '    },',
  ]);
  const packages = lineOf(lines, /^ {2}"packages": \{$/);
  insertSorted(lines, packages, /^ {2}\}/, /^ {4}"([^"]+)": \[/, packageName, [
    `    "${packageName}": ["${packageName}@workspace:${directory}"],`,
    '',
  ]);
  return lines.join('\n');
}

/** The root manifest with the content workspace as a dependency, keys in code-point order. */
export function addDependency(content: string, packageName: string): string {
  const root = JSON.parse(content) as { dependencies?: Record<string, string> };
  const dependencies = { ...root.dependencies, [packageName]: 'workspace:*' };
  root.dependencies = Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => byCode(a, b)),
  );
  return `${JSON.stringify(root, null, 2)}\n`;
}
