/**
 * Prepare one development launch of the starter.
 *
 *   bun run dev
 *   cd examples/quality-inspection && bun run dev
 *   bun scripts/dev-desktop.ts examples/quality-inspection --port 4322
 *
 * From an example directory (or an example path), that package becomes the starter's
 * application through `AGENT_NATIVE_APPLICATION` for the web build and the service (P11).
 * From the repository root, `app.config.json` names the application. The workspace is
 * `<example>/.workspace` or the repository `.workspace` (both ignored by git). Each
 * example's `dev` script passes its own port. An optional `<example>/dev.ts` runs first
 * to start demo dependencies, such as the fake HMI. Explicit `PORT`, `WORKSPACE_PATH`
 * and demo variables win. Nothing is discovered and no credential is read.
 *
 * `bun run dev` opens the desktop window (`dev-desktop.ts`). This file's main entry
 * serves the browser instead (`bun run dev:web` from an example).
 */
import { join, resolve } from 'node:path';
import { readStarterConfig } from '@agent-native/host/config';
import { configuredApplication, starterConfigPath } from '../apps/service/src/application';
import { runService } from '../apps/service/src/index';

export interface PreparedDevelopment {
  root: string;
  packageName: string;
  workspace: string;
  /** Set when the launch named a port or the environment already had `PORT`. */
  port?: string;
  applicationId: string;
  title: string;
}

export async function prepareDevelopment(argv: string[]): Promise<PreparedDevelopment> {
  const args = [...argv];
  const portFlag = args.indexOf('--port');
  const port = portFlag < 0 ? undefined : args.splice(portFlag, 2)[1];
  const root = resolve(import.meta.dir, '..');
  const requested = args[0];
  const directory = resolve(requested ?? process.cwd());
  const manifest = (await Bun.file(join(directory, 'package.json'))
    .json()
    .catch(() => undefined)) as { name?: string } | undefined;
  const example =
    Boolean(manifest?.name) && (await Bun.file(join(directory, 'application.ts')).exists());
  if (requested && !example) {
    console.error(`${directory} is not an example: it needs a package.json and an application.ts`);
    process.exit(1);
  }
  if (!example && directory !== root) {
    console.error(`${directory} is not an example: it needs a package.json and an application.ts`);
    process.exit(1);
  }
  if (example && manifest?.name) process.env.AGENT_NATIVE_APPLICATION = manifest.name;

  // The web build, the default web root and relative station profiles resolve against the root.
  process.chdir(root);
  const build = Bun.spawnSync(['bun', 'run', 'build:web'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

  if (example && (await Bun.file(join(directory, 'dev.ts')).exists()))
    await import(join(directory, 'dev.ts'));

  process.env.WORKSPACE_PATH ??= example ? join(directory, '.workspace') : join(root, '.workspace');
  if (port) process.env.PORT ??= port;
  const application = await configuredApplication();
  const packageName =
    process.env.AGENT_NATIVE_APPLICATION ?? readStarterConfig(starterConfigPath).application;
  return {
    root,
    packageName,
    workspace: process.env.WORKSPACE_PATH,
    ...(process.env.PORT ? { port: process.env.PORT } : {}),
    applicationId: application.manifest.id,
    title: application.manifest.title,
  };
}

if (import.meta.main) {
  const prepared = await prepareDevelopment(process.argv.slice(2));
  const host = await runService(await configuredApplication());
  console.log(
    `\n${prepared.title}: open ${host.launchUrl}\n` +
      `  The link signs you in once and expires after one minute; restart for a fresh one.\n` +
      `  CLI: AGENT_NATIVE_APPLICATION=${prepared.packageName} AGENT_NATIVE_CONNECTION=${host.connectionFile} bun run cli list\n`,
  );
}
