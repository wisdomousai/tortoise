import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  desktopTargets,
  type DesktopTarget,
  type RuntimeManifest,
} from '@agent-native/host/runtime-manifest';
import {
  downloadNativePackage,
  listFiles,
  runtimeVersions,
  sha256,
  targetPackages,
} from './package-assets';
import { readApplicationIdentity } from '@agent-native/host/config';
import { optionalHostPackages } from '@agent-native/host/optional-packages';
import { loadManifest, readStarterConfig } from '@agent-native/host/config';
import { writeApplicationEntry } from './application-entry';

export async function stageDesktop(target: DesktopTarget, output?: string) {
  if (!desktopTargets.includes(target)) throw new Error(`Unsupported target ${target}`);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const identity = readApplicationIdentity(resolve(root, 'app.config.json'));
  const stage = output ?? resolve(root, 'artifacts/desktop', target);
  // A stage is immutable: refusing an existing target also protects in-flight builds.
  await mkdir(stage, { recursive: false });
  const resources = resolve(stage, 'resources');
  await mkdir(resources);
  const packages = targetPackages(target);
  for (const name of ['codex', 'claude', 'keyring'] as const) {
    process.stdout.write(`Staging ${packages[name].name}@${packages[name].version}\n`);
    await downloadNativePackage(packages[name], resolve(resources, 'runtimes', name));
  }
  const files = await listFiles(resources);
  // Match on resource-relative POSIX paths: listFiles returns native paths, which use `\` on Windows.
  const rel = (path: string) => relative(resources, path).split('\\').join('/');
  const find = (predicate: (file: string) => boolean) => {
    const matches = files.filter((file) => predicate(rel(file)));
    if (matches.length !== 1)
      throw new Error(`Expected exactly one native resource, found ${matches.length}`);
    return matches[0]!;
  };
  const nativeName = target.startsWith('win32') ? 'codex.exe' : 'codex';
  const codex = find(
    (file) => file.startsWith('runtimes/codex/') && file.endsWith(`/bin/${nativeName}`),
  );
  const claude = find(
    (file) =>
      file.startsWith('runtimes/claude/') &&
      file.endsWith(target.startsWith('win32') ? '/claude.exe' : '/claude'),
  );
  const keyring = find((file) => file.startsWith('runtimes/keyring/') && file.endsWith('.node'));
  const entry = resolve(stage, 'service-entry.ts');
  // Direct .node require is statically visible to Bun, unlike npm's dynamic platform
  // loader. Initialization precedes importing the service composition root.
  await writeFile(
    entry,
    `import { installNativeCredentialBinding } from ${JSON.stringify(resolve(root, 'packages/agents/src/credentials.ts'))};\nconst binding = require(${JSON.stringify(keyring)});\ninstallNativeCredentialBinding(binding);\nawait import(${JSON.stringify(await writeApplicationEntry('service', stage))});\n`,
  );
  const service = resolve(resources, target.startsWith('win32') ? 'service.exe' : 'service');
  const bunTarget =
    `bun-${target.replace('darwin', 'darwin').replace('win32', 'windows')}` as 'bun-darwin-arm64';
  const build = await Bun.build({
    entrypoints: [entry],
    compile: { target: bunTarget, outfile: service, autoloadDotenv: false, autoloadBunfig: false },
    // Optional adapters load these at runtime; they are never compiled in.
    external: [...optionalHostPackages],
    minify: true,
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  await chmod(service, 0o755);
  const { id } = await loadManifest(readStarterConfig(resolve(root, 'app.config.json')));
  // The web build of the hosted application (`bun run build:web`).
  await cp(resolve(root, 'dist/web', id), resolve(resources, 'web'), { recursive: true });
  const sitePolicy = resolve(resources, 'site-policy.json');
  await cp(resolve(root, 'apps/desktop/site-policy.json'), sitePolicy);
  const runtime = async (name: 'codex' | 'claude', executable: string) => ({
    executable: rel(executable),
    version: runtimeVersions[name],
    files: await Promise.all(
      files
        .filter((file) => rel(file).startsWith(`runtimes/${name}/`))
        .map(async (file) => ({ path: rel(file), sha256: await sha256(file) })),
    ),
  });
  const manifest: RuntimeManifest = {
    format: 1,
    target,
    service: { executable: rel(service), sha256: await sha256(service) },
    webRoot: 'web',
    sitePolicy: { path: rel(sitePolicy), sha256: await sha256(sitePolicy) },
    runtimes: { codex: await runtime('codex', codex), claude: await runtime('claude', claude) },
  };
  await writeFile(
    resolve(resources, 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const appDir = resolve(stage, 'app');
  await mkdir(appDir);
  for (const [name, format] of [
    ['main', 'esm'],
    ['preload', 'cjs'],
  ] as const) {
    const result = await Bun.build({
      entrypoints: [resolve(root, `apps/desktop/src/${name}.ts`)],
      target: 'node',
      format,
      external: ['electron'],
      naming: `${name}.${format === 'esm' ? 'mjs' : 'cjs'}`,
      outdir: appDir,
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  }
  const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await cp(resolve(root, 'app.config.json'), resolve(appDir, 'app.config.json'));
  await writeFile(
    resolve(appDir, 'package.json'),
    JSON.stringify(
      {
        name: identity.name,
        version: rootPackage.version,
        type: 'module',
        main: 'main.mjs',
        dependencies: {},
        description: identity.displayName,
        author: 'Application owner',
      },
      null,
      2,
    ),
  );
  return stage;
}
if (import.meta.main) {
  const target = (process.argv[2] ?? `${process.platform}-${process.arch}`) as DesktopTarget;
  // Ensure the parent exists without modifying a previous target stage.
  const output = process.argv[3] ? resolve(process.argv[3]) : resolve('artifacts/desktop', target);
  await mkdir(dirname(output), { recursive: true });
  const stage = await stageDesktop(target, output);
  process.stdout.write(`Desktop stage ready: ${stage}\n`);
}
