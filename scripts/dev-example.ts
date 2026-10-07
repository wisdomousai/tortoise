/**
 * Start the reference service for one example, from that example's directory.
 *
 *   cd examples/quality-inspection && bun run dev
 *   bun scripts/dev-example.ts quality-inspection
 *
 * Builds the web app, then runs the same authority as `bun run dev` with a workspace and port of
 * its own (`examples/<name>/.workspace`, ignored by git), so the examples can run side by side.
 * The service composes every example; the name only picks the workspace, the port, the demo
 * dependencies and the screen to open first. `line-station` also starts the fake HMI with
 * simulation endpoints in this process and bridges it; counters come from the simulator unless
 * a vision model or perception worker is configured. Explicit `PORT`, `WORKSPACE_PATH` and
 * `STATION_*` / `DEMO_*` variables win. Demo only: nothing is discovered and no credential is read.
 */
import { resolve } from 'node:path';
import { serve } from '../apps/service/src/serve';
import { startFakeHmi } from '../examples/line-station/fake-hmi/server';

const examples = {
  'project-tasks': { port: 4321, screen: 'Projects' },
  'quality-inspection': { port: 4322, screen: 'Inspection' },
  'line-station': { port: 4323, screen: 'Station', hmi: true },
} as const satisfies Record<string, { port: number; screen: string; hmi?: boolean }>;

const name = process.argv[2];
if (!name || !Object.hasOwn(examples, name)) {
  console.error(`Usage: bun scripts/dev-example.ts <${Object.keys(examples).join('|')}>`);
  process.exit(1);
}
const example: { port: number; screen: string; hmi?: boolean } =
  examples[name as keyof typeof examples];

// Relative defaults (web root, station profile) resolve against the repository root.
const root = resolve(import.meta.dir, '..');
process.chdir(root);

const build = Bun.spawnSync(['bun', 'run', 'build:web'], { stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

if (example.hmi) {
  const hmi = startFakeHmi({ simulationEndpoints: true });
  process.env.STATION_HMI_URL ??= hmi.url;
  if (!process.env.STATION_VISION_BASE_URL && !process.env.STATION_PERCEPTION_WORKER)
    process.env.STATION_SIMULATOR ??= '1';
  console.log(`Fake HMI: ${hmi.url} (simulation endpoints under /__sim/)`);
}

const host = await serve({
  workspacePath: resolve(process.env.WORKSPACE_PATH ?? `examples/${name}/.workspace`),
  port: Number(process.env.PORT ?? example.port),
  webRoot: resolve('dist/web'),
  runtimeManifest: process.env.AGENT_RUNTIME_MANIFEST,
});
console.log(
  `\n${name}: open ${host.launchUrl}\n` +
    `  The link signs you in once and expires after one minute; restart for a fresh one.\n` +
    `  Then go to ${example.screen}. CLI: AGENT_NATIVE_CONNECTION=${host.connectionFile} bun run cli list\n`,
);
