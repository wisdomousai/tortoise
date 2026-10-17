/**
 * Packs and publishes the framework packages (`packages/*` and `plugins/*`) at their shared
 * version. Versions are bumped with changesets (`bun run release:version`), never here.
 *
 *   bun scripts/release.ts pack [--out <dir>]
 *   bun scripts/release.ts serve [--out <dir>] [--port <port>]
 *   bun scripts/release.ts publish --registry <url> [--out <dir>] [--tag <tag>] [--access public|restricted] [--dry-run]
 *
 * `pack` checks the manifests, then writes one tarball per package to `dist/release`, with
 * `workspace:*` ranges replaced by the exact version. `serve` packs and serves the tarballs on
 * loopback (see `local-registry.ts`) so `scaffold new --framework` can be tried before anything
 * is published. `publish` uploads the packed tarballs in dependency order to the registry named
 * on the command line, with whatever credentials that registry's configuration provides; it
 * never chooses a registry itself, so nothing reaches the public registry by default.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPacked, startLocalRegistry } from './local-registry';
import { publishedLayers, workspaces } from './workspace-manifests';

const root = resolve(import.meta.dir, '..');

async function run(command: string[], cwd = root): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`${command.join(' ')} failed in ${cwd}`);
}

/** Pack every publishable workspace into `out`, replacing what was there. */
export async function packFramework(out: string, checkout = root): Promise<string[]> {
  await run(['bun', join(checkout, 'scripts/check-manifests.ts')], checkout);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const published = workspaces(checkout, publishedLayers);
  for (const workspace of published)
    await run(
      ['bun', 'pm', 'pack', '--destination', out, '--quiet'],
      join(checkout, workspace.directory),
    );
  return published.map((workspace) => workspace.manifest.name);
}

/** Packed packages ordered so each comes after the framework packages it depends on. */
function dependencyOrder<T extends { manifest: { name: string; dependencies?: unknown } }>(
  packed: readonly T[],
): T[] {
  const byName = new Map(packed.map((item) => [item.manifest.name, item]));
  const ordered: T[] = [];
  const visiting = new Set<string>();
  const visit = (item: T) => {
    if (ordered.includes(item) || visiting.has(item.manifest.name)) return;
    visiting.add(item.manifest.name);
    for (const name of Object.keys((item.manifest.dependencies ?? {}) as object))
      if (byName.has(name)) visit(byName.get(name)!);
    ordered.push(item);
  };
  for (const item of packed) visit(item);
  return ordered;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main(args: readonly string[]) {
  const command = args[0];
  const out = resolve(option(args, '--out') ?? join(root, 'dist/release'));
  if (command === 'pack') {
    const names = await packFramework(out);
    console.log(`Packed ${names.length} framework packages into ${out}`);
    return;
  }
  if (command === 'serve') {
    await packFramework(out);
    const port = option(args, '--port');
    const registry = await startLocalRegistry(out, port ? { port: Number(port) } : {});
    console.log(`Serving ${out} at ${registry.url}`);
    console.log(
      `Try: bun run scaffold new <absent-directory> --name <app> --framework <version> --registry ${registry.url}`,
    );
    return;
  }
  if (command === 'publish') {
    const registry = option(args, '--registry');
    if (!registry) throw new Error('publish needs --registry <url>; it never picks one itself');
    const extra = [
      ...(option(args, '--tag') ? ['--tag', option(args, '--tag')!] : []),
      ...(option(args, '--access') ? ['--access', option(args, '--access')!] : []),
      ...(args.includes('--dry-run') ? ['--dry-run'] : []),
    ];
    for (const item of dependencyOrder(await readPacked(out)))
      await run(['bun', 'publish', join(out, item.file), '--registry', registry, ...extra]);
    return;
  }
  throw new Error(
    'Usage: bun scripts/release.ts pack|serve|publish [--out <dir>] [--registry <url>]',
  );
}

if (import.meta.main) await main(process.argv.slice(2));
