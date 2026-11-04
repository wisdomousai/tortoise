/**
 * Open the desktop window. `bun run dev` from the repository root or an example directory
 * runs this. Electron starts the Bun service for that workspace, or attaches when one
 * already holds it, and loads the window. Closing a window Electron started also stops
 * that service. See `dev-example.ts` for how the application, workspace and demo process
 * are chosen. `bun run dev:web` serves a browser without opening the window.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareDevelopment } from './dev-example';

const require = createRequire(import.meta.url);

const prepared = await prepareDevelopment(process.argv.slice(2));
const appDir = resolve(prepared.root, 'dist/desktop');
await mkdir(appDir, { recursive: true });
for (const [name, format] of [
  ['main', 'esm'],
  ['preload', 'cjs'],
] as const) {
  const result = await Bun.build({
    entrypoints: [resolve(prepared.root, `apps/desktop/src/${name}.ts`)],
    target: 'node',
    format,
    external: ['electron'],
    naming: `${name}.${format === 'esm' ? 'mjs' : 'cjs'}`,
    outdir: appDir,
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
}
const rootPackage = JSON.parse(await readFile(resolve(prepared.root, 'package.json'), 'utf8')) as {
  version: string;
};
await cp(resolve(prepared.root, 'app.config.json'), resolve(appDir, 'app.config.json'));
await writeFile(
  resolve(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'tortoise-desktop-dev',
      version: rootPackage.version,
      private: true,
      type: 'module',
      main: 'main.mjs',
    },
    null,
    2,
  ),
);

const sitePolicy =
  process.env.TORTOISE_SITE_POLICY === undefined
    ? resolve(prepared.root, 'apps/desktop/site-policy.json')
    : process.env.TORTOISE_SITE_POLICY.trim();
const electronBinary = require('electron') as string;
console.log(`Opening ${prepared.title}…`);
const child = spawn(electronBinary, [appDir], {
  cwd: prepared.root,
  env: {
    ...process.env,
    TORTOISE_DESKTOP_DEV: '1',
    TORTOISE_APPLICATION: prepared.packageName,
    TORTOISE_WORKSPACE: prepared.workspace,
    TORTOISE_WEB_ROOT: resolve(prepared.root, 'dist/web', prepared.applicationId),
    TORTOISE_SERVICE_ENTRY: resolve(prepared.root, 'apps/service/src/index.ts'),
    TORTOISE_BUN: process.execPath,
    TORTOISE_DEV_ROOT: prepared.root,
    PORT: prepared.port ?? '4317',
    ...(sitePolicy ? { TORTOISE_SITE_POLICY: sitePolicy } : {}),
  },
  stdio: 'inherit',
});
child.once('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once('exit', (code) => process.exit(code ?? 1));
