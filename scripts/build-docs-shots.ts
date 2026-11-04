/**
 * Build the web frame for each example that has a screenshot spec (`e2e/*.shots.ts`), so the
 * documentation's screenshot run finds `dist/web/<application id>`. Node-compatible: Playwright
 * loads it as the global setup of `tests/docs/playwright.config.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default function buildDocsShots() {
  const layer = resolve(root, 'showcase/examples');
  if (!existsSync(layer)) return;
  const directories = readdirSync(layer, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(layer, entry.name))
    .filter(
      (directory) =>
        existsSync(resolve(directory, 'e2e')) &&
        readdirSync(resolve(directory, 'e2e')).some((name) => name.endsWith('.shots.ts')),
    );
  for (const directory of directories) {
    const build = spawnSync('bun', ['run', 'build:web'], {
      cwd: root,
      env: { ...process.env, TORTOISE_APPLICATION: directory },
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error(`Web build failed for ${directory}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  buildDocsShots();
