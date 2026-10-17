/**
 * Fails when a publishable workspace's manifest would not install on its own from a registry: a
 * dependency its published source imports is missing or stale, it is private, its version
 * differs from the other framework packages, or it lacks the repository directory and packed
 * file list. `--write` rewrites the manifests to what is expected; problems a rewrite cannot fix,
 * such as an import the root manifest does not list, still fail.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  expectedManifest,
  publishedLayers,
  workspaces,
  type Manifest,
} from './workspace-manifests';

const root = resolve(import.meta.dir, '..');
const write = process.argv.includes('--write');

/** Manifest keys in the order they are written; others keep their place after `exports`. */
const leading = ['name', 'version', 'type', 'description', 'repository', 'files', 'exports'];
const trailing = ['dependencies', 'peerDependencies', 'peerDependenciesMeta'];
function ordered(manifest: Manifest): Manifest {
  const keys = Object.keys(manifest);
  const middle = keys.filter((key) => !leading.includes(key) && !trailing.includes(key));
  return Object.fromEntries(
    [...leading, ...middle, ...trailing]
      .filter((key) => key in manifest)
      .map((key) => [key, manifest[key]]),
  ) as Manifest;
}

const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  repository?: { url?: string };
};
const published = workspaces(root, publishedLayers);
const errors: string[] = [];
if (published.length) {
  const repositoryUrl = rootManifest.repository?.url;
  if (!repositoryUrl) errors.push('package.json: the root manifest needs repository.url');
  const byName = new Map(published.map((workspace) => [workspace.manifest.name, workspace]));
  const versions = new Set(published.map((workspace) => workspace.manifest.version));
  if (versions.size > 1)
    errors.push(
      `framework packages must share one version, found ${[...versions].sort().join(', ')}`,
    );
  for (const workspace of published) {
    const { manifest, problems } = expectedManifest(root, workspace, byName, repositoryUrl ?? '');
    for (const problem of problems) errors.push(`${workspace.directory}: ${problem}`);
    const path = join(root, workspace.directory, 'package.json');
    const expected = `${JSON.stringify(ordered(manifest), null, 2)}\n`;
    if (readFileSync(path, 'utf8') === expected) continue;
    if (write) writeFileSync(path, expected);
    else
      errors.push(
        `${workspace.directory}/package.json: dependencies, repository or files differ from its published source; run bun scripts/check-manifests.ts --write`,
      );
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  write
    ? `Wrote ${published.length} publishable manifests`
    : `${published.length} publishable manifests match their published source`,
);
