/**
 * Build the web frame once per example (`dist/web/<application id>`), for the end-to-end suite and
 * for running any example from one checkout. `bun run build:web` builds only the configured one.
 * Node-compatible: Playwright loads it as its global setup.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export default function buildExampleWeb() {
  for (const entry of readdirSync(resolve(root, 'examples'), { withFileTypes: true })) {
    const directory = resolve(root, 'examples', entry.name);
    if (!entry.isDirectory() || !existsSync(resolve(directory, 'screens.tsx'))) continue;
    const build = spawnSync('bun', ['run', 'build:web'], {
      cwd: root,
      env: { ...process.env, AGENT_NATIVE_APPLICATION: directory },
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error(`Web build failed for ${entry.name}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  buildExampleWeb();
