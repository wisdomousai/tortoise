/**
 * Fails when Markdown uses a word from the "Plain words" lists in `docs/styleguide.md`. The lists
 * are read from the styleguide's `text` blocks, so the styleguide stays the only copy. Code fences
 * and inline code are skipped. With no arguments it checks every tracked Markdown file except the
 * styleguide; with file arguments it checks those files, and `-` reads a draft from stdin.
 * Reads files only; writes nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const styleguide = 'docs/styleguide.md';

/** The comma-separated terms in the `text` blocks of the "Plain words" section. */
function bannedTerms(): string[] {
  const text = readFileSync(resolve(root, styleguide), 'utf8');
  const start = text.indexOf('## Plain words');
  if (start < 0) throw new Error(`${styleguide} has no "## Plain words" section`);
  const next = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, next < 0 ? undefined : next);
  const blocks = [...section.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  return blocks
    .flatMap((block) => block.split(','))
    .map((term) => term.trim())
    .filter(Boolean);
}

function patternFor(term: string): RegExp {
  const words = term.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b${words.join('\\s+')}\\b`, 'i');
}

/** The lines a reader sees as prose: fenced code blocks and inline code become blank. */
function proseLines(text: string): string[] {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line.replace(/`[^`]*`/g, '');
  });
}

function trackedMarkdown(): string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '*.md'], { cwd: root, stdout: 'pipe' });
  return new TextDecoder()
    .decode(listed.stdout)
    .split('\n')
    .filter((path) => path && path !== styleguide && !path.startsWith('dist/'));
}

const patterns = bannedTerms().map((term) => ({ term, pattern: patternFor(term) }));
const args = process.argv.slice(2);
const sources =
  args.length === 0
    ? trackedMarkdown().map((path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') }))
    : args.map((path) =>
        path === '-'
          ? { path: 'stdin', text: readFileSync(0, 'utf8') }
          : { path, text: readFileSync(resolve(process.cwd(), path), 'utf8') },
      );

let hits = 0;
for (const { path, text } of sources) {
  proseLines(text).forEach((line, index) => {
    for (const { term, pattern } of patterns) {
      if (!pattern.test(line)) continue;
      hits += 1;
      console.log(`${path}:${index + 1}: "${term}"`);
    }
  });
}
if (hits > 0) {
  console.error(`${hits} uses of words that ${styleguide} rules out (Plain words)`);
  process.exit(1);
}
console.log(`Checked ${sources.length} files against ${patterns.length} terms from ${styleguide}`);
