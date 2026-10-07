/**
 * Start the starter with one example as its application, from that example's directory:
 *
 *   cd examples/quality-inspection && bun run dev
 *   bun scripts/dev-example.ts examples/quality-inspection [--port 4322]
 *
 * The example is the package in the current (or given) directory; it becomes the starter's
 * application through `AGENT_NATIVE_APPLICATION` for both the web build and the service (P11),
 * so only its catalog, screens and integrations load. The workspace is `<example>/.workspace`
 * (ignored by git) and each example's `dev` script passes its own port, so examples run side by
 * side. An optional `<example>/dev.ts` runs first to start demo dependencies, such as the fake HMI.
 * Explicit `PORT`, `WORKSPACE_PATH` and demo variables win. Nothing is discovered and no
 * credential is read.
 */
import { join, resolve } from 'node:path';
import { configuredApplication } from '../apps/service/src/application';
import { runService } from '../apps/service/src/index';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = portFlag < 0 ? undefined : args.splice(portFlag, 2)[1];
const directory = resolve(args[0] ?? process.cwd());
const manifest = (await Bun.file(join(directory, 'package.json'))
  .json()
  .catch(() => undefined)) as { name?: string } | undefined;
if (!manifest?.name || !(await Bun.file(join(directory, 'application.ts')).exists())) {
  console.error(`${directory} is not an example: it needs a package.json and an application.ts`);
  process.exit(1);
}
process.env.AGENT_NATIVE_APPLICATION = manifest.name;

// The web build, the default web root and relative station profiles resolve against the root.
const root = resolve(import.meta.dir, '..');
process.chdir(root);
const build = Bun.spawnSync(['bun', 'run', 'build:web'], { stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

if (await Bun.file(join(directory, 'dev.ts')).exists()) await import(join(directory, 'dev.ts'));

process.env.WORKSPACE_PATH ??= join(directory, '.workspace');
if (port) process.env.PORT ??= port;
const application = await configuredApplication();
const host = await runService(application);
console.log(
  `\n${application.manifest.title}: open ${host.launchUrl}\n` +
    `  The link signs you in once and expires after one minute; restart for a fresh one.\n` +
    `  CLI: AGENT_NATIVE_APPLICATION=${manifest.name} AGENT_NATIVE_CONNECTION=${host.connectionFile} bun run cli list\n`,
);
