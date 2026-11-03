import { controls, controlsMarkdown } from '@agent-native/compliance';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ApplicationManifest } from '@agent-native/host';
import { applications, artifacts, json, root } from './reference-artifacts';

// Writes every application's reference to an ignored directory, replacing what was there. The
// output is for reading and is not committed; `bun run check` runs this so a catalog that cannot
// be documented fails.
const directory = join(root, 'dist', 'reference');
await rm(directory, { recursive: true, force: true });
const manifests = await applications();
// The overview map checks its claims against the framework packages and every reference example,
// so it exists only in a checkout that has them; an export that leaves any out has no overview.
const overviewScript = join(root, 'scripts', 'overview.ts');
const overview = existsSync(overviewScript)
  ? (
      (await import(overviewScript)) as {
        overview(root: string, manifests: readonly ApplicationManifest[]): Promise<unknown>;
      }
    ).overview
  : undefined;
// The control mapping is the framework's, not one application's.
const outputs = [
  ['controls.json', json(controls)] as const,
  ['controls.md', controlsMarkdown(controls)] as const,
  // The overview map's data, read by `docs/site/src/components/OverviewView.astro`.
  ...(overview ? [['overview.json', json(await overview(root, manifests))] as const] : []),
  ...manifests.flatMap((manifest) =>
    [...artifacts(manifest)].map(([name, content]) => [join(manifest.id, name), content] as const),
  ),
];
for (const [name, content] of outputs) {
  const path = join(directory, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
console.log(
  `Generated ${outputs.length} reference artifacts for ${manifests.length} applications in dist/reference`,
);
