/**
 * Checks that `docs/primitives.md` still describes the code and cites live principles from
 * `docs/principles.md`. It fails when a listed symbol or location no longer exists, a row cites an
 * unknown or retired principle, a framework package has no row, or a principle has no implemented
 * primitive. It reads only repository files and never imports application code.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const errors: string[] = [];
const statuses = new Set(['implemented', 'partial', 'proposed']);

const principlesText = await readFile(resolve(root, 'docs/principles.md'), 'utf8');
const principles = new Map<string, { retired: boolean }>();
for (const match of principlesText.matchAll(/^### (P\d+) — .*\n+([^\n]*)/gm))
  principles.set(match[1]!, { retired: match[2]!.startsWith('Retired:') });
if (principles.size === 0) errors.push('docs/principles.md: no "### Pn — title" headings found');

/** Source files under a location, skipping tests and build output. */
async function sources(path: string): Promise<string[]> {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test'].includes(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...(await sources(child)));
    else if (/\.[cm]?tsx?$/.test(child) && !/\.(test|pw)\./.test(child)) result.push(child);
  }
  return result;
}

/** True when `name` is exported from one of the files, or is one of their base names. */
function provides(name: string, files: readonly string[], texts: readonly string[]): boolean {
  if (files.some((file) => basename(file, extname(file)) === name)) return true;
  const declared = new RegExp(
    `^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?|const|let|class|type|interface|enum)\\s+${name}\\b`,
    'm',
  );
  const listed = new RegExp(`^export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm');
  return texts.some((text) => declared.test(text) || listed.test(text));
}

const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
const catalogText = await readFile(resolve(root, 'docs/primitives.md'), 'utf8');
const realized = new Set<string>();
const locations = new Set<string>();
let header: string[] | undefined;
for (const [index, line] of catalogText.split('\n').entries()) {
  if (!line.startsWith('|')) {
    header = undefined;
    continue;
  }
  const cells = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  if (!header) {
    header = cells;
    continue;
  }
  if (header[0] !== 'Primitive' || /^:?-+/.test(cells[0]!)) continue;
  const column = (name: string) => cells[header!.indexOf(name)] ?? '';
  const where = `docs/primitives.md:${index + 1} (${cells[0]})`;
  const status = column('Status');
  if (!statuses.has(status)) errors.push(`${where}: unknown status "${status}"`);
  const cited = column('Principles').match(/P\d+/g) ?? [];
  if (cited.length === 0) errors.push(`${where}: cites no principle`);
  for (const id of cited) {
    const principle = principles.get(id);
    if (!principle) errors.push(`${where}: unknown principle ${id}`);
    else if (principle.retired) errors.push(`${where}: cites retired principle ${id}`);
    else if (status !== 'proposed') realized.add(id);
  }
  if (status === 'proposed') continue;

  const files: string[] = [];
  for (const location of ticked(column('Location'))) {
    locations.add(location);
    try {
      files.push(...(await sources(resolve(root, location))));
    } catch {
      errors.push(`${where}: location ${location} does not exist`);
    }
  }
  const texts = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  for (const symbol of ticked(column('Symbols')))
    if (!provides(symbol, files, texts))
      errors.push(`${where}: ${symbol} is not exported from ${column('Location')}`);
}

for (const [id, principle] of principles)
  if (!principle.retired && !realized.has(id))
    errors.push(`docs/principles.md: ${id} has no implemented or partial primitive`);
for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true }))
  if (entry.isDirectory() && !locations.has(`packages/${entry.name}`))
    errors.push(`docs/primitives.md: packages/${entry.name} has no catalog row`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Principles: ${principles.size} principles, ${locations.size} locations checked.`);
