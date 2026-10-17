/**
 * Keeps workspace READMEs reachable and their links working. For every workspace in
 * `packages/*`, `plugins/*`, `apps/*`, `examples/*` and `sdks/*` it fails when `README.md` is missing or
 * its title is not the package name, or when a relative link points at a missing file or a
 * missing heading in a Markdown file. What a README says, and how it is organized, is left to
 * its author. Reads files only; writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brokenLinks } from './markdown-links';

const root = resolve(import.meta.dir, '..');

interface Manifest {
  readonly name?: string;
}

const errors: string[] = [];
const workspaces: string[] = [];
for (const layer of ['packages', 'plugins', 'apps', 'examples', 'sdks'])
  for (const entry of existsSync(resolve(root, layer))
    ? readdirSync(resolve(root, layer), { withFileTypes: true })
    : [])
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

  for (const problem of brokenLinks(readmePath, readme)) report(problem);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${workspaces.length} workspace READMEs present, with working links.`);
