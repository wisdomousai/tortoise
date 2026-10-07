import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readApplicationIdentity } from '../apps/desktop/src/application-identity';
import { optionalHostPackages } from '../apps/service/src/optional-packages';

const root = resolve(import.meta.dir, '..');

/**
 * Compile the application CLI (`apps/service/src/cli.ts`) into one self-contained executable.
 * It needs no Bun, Node or package install on the target, so a sandbox image only copies this
 * file. The sandbox test compiles through this same function, so the gate checks the shipped
 * build configuration. Fails with the bundler's messages when compilation fails.
 */
export async function compileCli(outfile: string, target?: string): Promise<string> {
  const build = await Bun.build({
    entrypoints: [resolve(root, 'apps/service/src/cli.ts')],
    compile: {
      outfile,
      ...(target ? { target: target as 'bun-linux-x64' } : {}),
      // Configuration is explicit flags and environment; nothing is picked up from the cwd.
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    // Optional adapters load these at runtime; they are never compiled in.
    external: [...optionalHostPackages],
    minify: true,
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  await chmod(outfile, 0o755);
  return outfile;
}

/** `bun scripts/build-cli.ts [--target bun-linux-x64]` writes `dist/bin/<name>` from `app.config.json`. */
if (import.meta.main) {
  const { name } = readApplicationIdentity(resolve(root, 'app.config.json'));
  const targetIndex = process.argv.indexOf('--target');
  const target = targetIndex < 0 ? undefined : process.argv[targetIndex + 1];
  const windows = target ? target.includes('windows') : process.platform === 'win32';
  await mkdir(resolve(root, 'dist/bin'), { recursive: true });
  console.log(await compileCli(resolve(root, 'dist/bin', windows ? `${name}.exe` : name), target));
}
