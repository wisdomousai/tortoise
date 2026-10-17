/**
 * Keeps workspace READMEs reachable and their links working. For every workspace in
 * `packages/*`, `plugins/*`, `apps/*`, `examples/*` and `sdks/*` it fails when `README.md` is missing or
 * its title is not the package name, or when a relative link points at a missing file or a
 * missing heading in a Markdown file. What a README says, and how it is organized, is left to
 * its author. Reads files only; writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const headingCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
  let anchors = headingCache.get(file);
  if (!anchors) {
    anchors = new Set();
    const seen = new Map<string, number>();
    let fenced = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('```')) fenced = !fenced;
      const match = !fenced && /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
      if (!match) continue;
      const base = slug(match[1]!);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    headingCache.set(file, anchors);
  }
  return anchors;
}

interface Manifest {
  readonly name?: string;
}

const errors: string[] = [];
const workspaces: string[] = [];
for (const layer of ['packages', 'plugins', 'apps', 'examples', 'sdks'])
  for (const entry of readdirSync(resolve(root, layer), { withFileTypes: true }))
    if (entry.isDirectory() && existsSync(resolve(root, layer, entry.name, 'package.json')))
      workspaces.push(`${layer}/${entry.name}`);

for (const workspace of workspaces) {
  const directory = resolve(root, workspace);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as Manifest;
  const readmePath = resolve(directory, 'README.md');
  if (!existsSync(readmePath)) {
    errors.push(`${workspace}: README.md is missing`);
    continue;
  }
  const readme = readFileSync(readmePath, 'utf8');
  const name = manifest.name ?? workspace;
  const report = (problem: string) => errors.push(`${workspace}/README.md: ${problem}`);

  if (readme.split('\n', 1)[0] !== `# ${name}`) report(`first line must be "# ${name}"`);

  for (const [, target] of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z+.-]*:/i.test(target!)) continue;
    const [path, anchor] = target!.split('#') as [string, string | undefined];
    const file = path ? resolve(directory, path) : readmePath;
    if (!existsSync(file)) {
      report(`link to missing file ${target}`);
      continue;
    }
    if (anchor && file.endsWith('.md') && !anchorsOf(file).has(anchor))
      report(`link to missing heading ${target}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${workspaces.length} workspace READMEs present, with working links.`);
