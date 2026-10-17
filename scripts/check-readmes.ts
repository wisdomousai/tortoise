/**
 * Keeps workspace READMEs, package manifests and docs/primitives.md in step. For every
 * workspace in `packages/*`, `plugins/*`, `apps/*` and `examples/*` it fails when:
 *
 * - `README.md` is missing, or its title is not the package name;
 * - one of the required sections is missing;
 * - an `exports` subpath in `package.json` is not named, so a new entrypoint ships undocumented;
 * - a primitive entry whose code line names the workspace is not linked, or a link names a
 *   primitive heading that no longer exists;
 * - a relative link points at a missing file or a missing heading in a Markdown file.
 *
 * It checks references, not prose. Whether a README describes its package correctly is still
 * review discipline. Reads files only; writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const primitivesPath = resolve(root, 'docs/primitives.md');
export const requiredSections = [
  'Primitives',
  'Entrypoints',
  'Trust boundary',
  'Dependencies',
  'Tests',
] as const;

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

/** Workspace directory (`packages/host`) → anchors of the primitive entries that name it. */
function primitiveLocations(): Map<string, Set<string>> {
  const locations = new Map<string, Set<string>>();
  let heading: string | undefined;
  for (const line of readFileSync(primitivesPath, 'utf8').split('\n')) {
    const title = /^###\s+(.+)$/.exec(line);
    if (title) heading = slug(title[1]!);
    // An entry's code line starts with its status: `implemented · `packages/host` · …`.
    if (!heading || !/^(?:implemented|partial|proposed)\b/.test(line)) continue;
    for (const [, location] of line.matchAll(/`((?:packages|plugins|apps|examples)\/[\w-]+)`/g)) {
      const anchors = locations.get(location!) ?? new Set();
      anchors.add(heading);
      locations.set(location!, anchors);
    }
  }
  return locations;
}

interface Manifest {
  readonly name?: string;
  readonly exports?: Record<string, unknown>;
}

const errors: string[] = [];
const cited = primitiveLocations();
const workspaces: string[] = [];
for (const layer of ['packages', 'plugins', 'apps', 'examples'])
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
  for (const section of requiredSections)
    if (!new RegExp(`^## ${section}$`, 'm').test(readme)) report(`missing "## ${section}"`);
  for (const key of Object.keys(manifest.exports ?? {})) {
    const specifier = key === '.' ? name : `${name}${key.slice(1)}`;
    if (!readme.includes(`\`${specifier}\``)) report(`does not name the export \`${specifier}\``);
  }

  const linkedPrimitives = new Set<string>();
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
    if (anchor && file === primitivesPath) linkedPrimitives.add(anchor);
  }
  for (const anchor of cited.get(workspace) ?? [])
    if (!linkedPrimitives.has(anchor))
      report(
        `docs/primitives.md#${anchor} names ${workspace}; link it under "## Primitives" (${relative(dirname(readmePath), primitivesPath)}#${anchor})`,
      );
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${workspaces.length} workspace READMEs match their manifests and primitive entries.`);
