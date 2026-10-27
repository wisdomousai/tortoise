/**
 * Build the web frame once per example and once per sample with an `e2e` directory
 * (`dist/web/<application id>`), for the end-to-end suite and for running any of them from one
 * checkout. `bun run build:web` builds only the configured one. Node-compatible: Playwright loads
 * it as its global setup.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The application directories under `layer` that have screens and pass `include`. */
function applications(layer: string, include: (directory: string) => boolean) {
  return readdirSync(resolve(root, layer), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, layer, entry.name))
    .filter((directory) => existsSync(resolve(directory, 'screens.tsx')) && include(directory));
}

export default function buildExampleWeb() {
  const directories = [
    ...applications('examples', () => true),
    ...applications('samples', (directory) => existsSync(resolve(directory, 'e2e'))),
  ];
  for (const directory of directories) {
    const build = spawnSync('bun', ['run', 'build:web'], {
      cwd: root,
      env: { ...process.env, AGENT_NATIVE_APPLICATION: directory },
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error(`Web build failed for ${directory}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  buildExampleWeb();
