/**
 * Keeps modules small enough to hold one responsibility. For every non-test source file in
 * `packages/*`, `plugins/*`, `apps/*` and `examples/*` it fails when:
 *
 * - the file is longer than `maxFileLines`;
 * - a function, method, arrow function or component is longer than `maxFunctionLines`;
 * - a package `src/index.ts` contains anything but `export … from` re-exports;
 * - an entry in `sizeExemptions` no longer exceeds a limit, so the list cannot rot.
 *
 * Line counts include comments: a long explanation belongs next to a short function. Whether a
 * split follows responsibility rather than line count is still review discipline. Reads files
 * only; writes nothing.
 */
import { parse } from '@babel/parser';
import { relative, resolve } from 'node:path';
import {
  barrel,
  exemptSource,
  maxFileLines,
  maxFunctionLines,
  measuredSource,
  sizeExemptions,
} from './size-rules.ts';

const root = resolve(import.meta.dir, '..');

interface Node {
  readonly type: string;
  readonly loc?: { readonly start: { line: number }; readonly end: { line: number } };
  readonly [key: string]: unknown;
}

const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);
const reexports = new Set(['ExportAllDeclaration', 'ExportNamedDeclaration']);

const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as Node).type === 'string';

/** The name a reader would search for: declaration, variable, property or method key. */
function nameOf(node: Node, parent: Node | undefined): string {
  const named = (value: unknown) =>
    isNode(value) && typeof value.name === 'string' ? value.name : undefined;
  return (
    named(node.id) ??
    named(node.key) ??
    (parent?.type === 'VariableDeclarator' ? named(parent.id) : undefined) ??
    (parent?.type === 'ObjectProperty' ? named(parent.key) : undefined) ??
    '<anonymous>'
  );
}

function* functions(
  node: Node,
  parent?: Node,
): Generator<{ name: string; line: number; lines: number }> {
  if (functionTypes.has(node.type) && node.loc)
    yield {
      name: nameOf(node, parent),
      line: node.loc.start.line,
      lines: node.loc.end.line - node.loc.start.line + 1,
    };
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    for (const child of Array.isArray(value) ? value : [value])
      if (isNode(child)) yield* functions(child, node);
  }
}

const files = (
  await Array.fromAsync(new Bun.Glob('{packages,plugins,apps,examples}/**/*').scan(root))
)
  .filter((path) => measuredSource.test(path) && !exemptSource.test(path))
  .sort();
const errors: string[] = [];
const used = new Set<(typeof sizeExemptions)[number]>();
const exemption = (path: string, name?: string) => {
  const entry = sizeExemptions.find((item) => item.path === path && item.function === name);
  if (entry) used.add(entry);
  return entry;
};

for (const path of files) {
  const source = await Bun.file(resolve(root, path)).text();
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  if (lines > maxFileLines && !exemption(path))
    errors.push(`${path}: ${lines} lines (file limit ${maxFileLines})`);
  const program = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', ...(/\.[cm]?[jt]sx$/.test(path) ? (['jsx'] as const) : [])],
  }).program as unknown as Node;
  const declarations = barrel.test(path)
    ? (program.body as Node[]).filter((node) => !reexports.has(node.type) || !node.source)
    : [];
  if (declarations.length)
    errors.push(
      `${path}:${declarations[0]!.loc?.start.line}: package entrypoint holds ${declarations.length} statements besides \`export … from\``,
    );
  for (const fn of functions(program))
    if (fn.lines > maxFunctionLines && !exemption(path, fn.name))
      errors.push(
        `${path}:${fn.line}: ${fn.name} is ${fn.lines} lines (function limit ${maxFunctionLines})`,
      );
}
for (const entry of sizeExemptions)
  if (!used.has(entry))
    errors.push(
      `scripts/size-rules.ts: stale exemption ${entry.path}${entry.function ? `#${entry.function}` : ''} (within limits or missing)`,
    );

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(
    `\n${errors.length} size violations (split by responsibility; see docs/development-and-testing.md#the-checks)`,
  );
  process.exit(1);
}
console.log(`Checked ${files.length} source files in ${relative(process.cwd(), root) || '.'}`);
