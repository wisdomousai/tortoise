/**
 * Reports long files and functions in `packages/*`, `workstations/*`, `plugins/*`, `apps/*`, `examples/*` and `patterns/*` as
 * hints for review; they never fail the check. It fails only when a package `src/index.ts` holds
 * anything but `export … from` re-exports, because importers rely on the entrypoint carrying no
 * code of its own. Reads files only; writes nothing.
 */
import { parse } from '@babel/parser';
import { relative, resolve } from 'node:path';
import {
  barrel,
  exemptSource,
  maxFileLines,
  maxFunctionLines,
  measuredSource,
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
  await Array.fromAsync(new Bun.Glob('{packages,plugins,apps,examples,patterns}/**/*').scan(root))
)
  .filter((path) => measuredSource.test(path) && !exemptSource.test(path))
  .sort();
const errors: string[] = [];
const hints: string[] = [];

for (const path of files) {
  const source = await Bun.file(resolve(root, path)).text();
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  if (lines > maxFileLines) hints.push(`${path}: ${lines} lines (over ${maxFileLines})`);
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
    if (fn.lines > maxFunctionLines)
      hints.push(`${path}:${fn.line}: ${fn.name} is ${fn.lines} lines (over ${maxFunctionLines})`);
}
if (hints.length)
  console.log(
    `Long files and functions, for review (split only where a second responsibility shows):\n${hints.join('\n')}\n`,
  );
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Checked ${files.length} source files in ${relative(process.cwd(), root) || '.'}`);
