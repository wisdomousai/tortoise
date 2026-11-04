import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readApplicationIdentity } from '@tortoise/host/config';
import { optionalHostPackages } from '@tortoise/host/optional-packages';
import { writeApplicationEntry } from './application-entry';

const root = resolve(import.meta.dir, '..');

/**
 * Compile the configured application's CLI (or `application`'s) into one self-contained
 * executable. It needs no Bun, Node or package install on the target, so a sandbox image only
 * copies this file. The sandbox test compiles through this same function, so the gate checks the
 * shipped build configuration. `builtAt` stamps the build time, now by default, which sets the
 * build's best-before date. Fails with the bundler's messages when compilation fails.
 */
export async function compileCli(
  outfile: string,
  target?: string,
  application?: string,
  builtAt?: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tortoise-cli-entry-'));
  try {
    return await compile(
      await writeApplicationEntry('cli', directory, application, builtAt),
      outfile,
      target,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function compile(entry: string, outfile: string, target?: string) {
  const build = await Bun.build({
    entrypoints: [entry],
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
