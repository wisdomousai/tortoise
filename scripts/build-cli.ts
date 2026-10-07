import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readApplicationIdentity } from '../apps/desktop/src/application-identity';

/**
 * Compile the application CLI (`apps/service/src/cli.ts`) into one self-contained executable at
 * `dist/bin/<name>`, named from `app.config.json`. It needs no Bun, Node or package install on the
 * target, so a sandbox image only copies this file. `--target bun-linux-x64` cross-compiles.
 */
const root = resolve(import.meta.dir, '..');
const { name } = readApplicationIdentity(resolve(root, 'app.config.json'));
const targetIndex = process.argv.indexOf('--target');
const target = targetIndex < 0 ? undefined : process.argv[targetIndex + 1];
const windows = target ? target.includes('windows') : process.platform === 'win32';
const outfile = resolve(root, 'dist/bin', windows ? `${name}.exe` : name);
await mkdir(resolve(root, 'dist/bin'), { recursive: true });
const build = await Bun.build({
  entrypoints: [resolve(root, 'apps/service/src/cli.ts')],
  compile: {
    outfile,
    ...(target ? { target: target as 'bun-linux-x64' } : {}),
    // Configuration is explicit flags and environment; nothing is picked up from the cwd.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  minify: true,
});
if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
await chmod(outfile, 0o755);
console.log(outfile);
