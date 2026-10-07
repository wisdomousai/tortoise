import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson } from '@agent-native/contracts';

const rootFiles = new Set([
  'package.json',
  'app.config.json',
  'bun.lock',
  'tsconfig.json',
  'playwright.config.ts',
  'README.md',
  'LICENSE',
  'AGENTS.md',
  'IMPLEMENTATION_PLAN.md',
  '.gitignore',
  '.prettierrc.json',
  '.prettierignore',
]);
const sourceDirectories = new Set([
  'packages',
  'apps',
  'examples',
  'scripts',
  'skills',
  'docs',
  'tests',
  '.github',
]);
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'artifacts',
  'test-results',
  'playwright-report',
  'coverage',
  '.git',
  '.codex',
  '.agents',
  '.aws',
  '.workspace',
  'workspace',
  'workspaces',
  'data',
  'credentials',
  'profiles',
  'provider-runs',
  'provider-conversations',
]);
const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.sh',
  '.py',
  '.toml',
  '.svg',
]);
export interface ScaffoldOptions {
  readonly target: string;
  readonly name: string;
  readonly displayName?: string;
  readonly sourceRoot?: string;
}
export interface ScaffoldManifest {
  readonly formatVersion: 1;
  readonly frameworkVersion: string;
  readonly application: {
    readonly name: string;
    readonly displayName: string;
    readonly appId: string;
  };
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

function allowedFile(path: string): boolean {
  const name = basename(path);
  if (['.connection.json', 'connection.json', 'session.json', 'sessions.json'].includes(name))
    return false;
  if (
    name.startsWith('.env') ||
    /(?:secret|credential|token|private[-_]?key).*\.(?:json|pem|key|p12)$/i.test(name)
  )
    return false;
  return rootFiles.has(path) || sourceExtensions.has(extname(name));
}
async function collect(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          !excludedDirectories.has(entry.name) &&
          !entry.name.startsWith('.scaffold-') &&
          (path || sourceDirectories.has(entry.name))
        )
          await walk(child);
      } else if (entry.isFile() && (path || rootFiles.has(entry.name)) && allowedFile(child))
        files.push(child);
    }
  }
  await walk('');
  return files.sort();
}

/** Resolve existing ancestors without creating directories or following the absent target. */
async function targetPath(path: string): Promise<string> {
  const suffix = [basename(path)];
  let parent = dirname(path);
  for (;;) {
    try {
      return join(await realpath(parent), ...suffix);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      suffix.unshift(basename(parent));
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

/** Export the complete canonical starter as local source; it does not invent a new business domain. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldManifest> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.name) || options.name.length > 100)
    throw new Error('Application name must be a lowercase npm-style name');
  const requestedSourceRoot = resolve(options.sourceRoot ?? join(import.meta.dir, '../../..'));
  const sourceRoot = await realpath(requestedSourceRoot);
  const target = await targetPath(resolve(options.target));
  const withinSource = relative(sourceRoot, target);
  if (
    !withinSource ||
    (!withinSource.startsWith(`..${sep}`) && withinSource !== '..' && !isAbsolute(withinSource))
  )
    throw new Error('Scaffold target must be outside the source checkout');
  if (
    await lstat(target).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    )
  )
    throw new Error(`Refusing to overwrite existing target: ${target}`);
  const sourcePackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const displayName =
    options.displayName ??
    options.name
      .split('-')
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(' ');
  if (!displayName.trim() || displayName.length > 120 || /[\r\n\x00-\x1f]/.test(displayName))
    throw new Error('Display name must be nonempty single-line text of at most 120 characters');
  const application = { name: options.name, displayName, appId: `dev.agentnative.${options.name}` };
  const paths = await collect(sourceRoot);
  const files: { path: string; content: string; sha256: string }[] = [];
  for (const path of paths) {
    let content = await readFile(join(sourceRoot, path), 'utf8');
    if (content.includes(sourceRoot) || content.includes(requestedSourceRoot))
      throw new Error(`Source file contains checkout-specific absolute path: ${path}`);
    content = content.replaceAll(sourcePackage.name, options.name);
    // Native application names and browser titles are explicitly owned by the exported app.
    if (path === 'apps/web/index.html')
      content = content.replace(
        /<title>[^<]*<\/title>/,
        `<title>${displayName.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</title>`,
      );
    if (path === 'app.config.json') content = JSON.stringify(application, null, 2) + '\n';
    files.push({ path, content, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const manifest: ScaffoldManifest = {
    formatVersion: 1,
    frameworkVersion: sourcePackage.version,
    application,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  // Prepare all bytes before reserving the target. An exclusive mkdir refuses existing targets,
  // including empty directories and symlinks; rename publishes only our reserved empty directory.
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), '.scaffold-'));
  let reserved = false;
  try {
    for (const file of files) {
      await mkdir(dirname(join(staging, file.path)), { recursive: true });
      await writeFile(join(staging, file.path), file.content, { flag: 'wx' });
    }
    await writeFile(
      join(staging, 'scaffold.manifest.json'),
      JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2) + '\n',
      { flag: 'wx' },
    );
    await mkdir(target);
    reserved = true;
    await rename(staging, target);
    return manifest;
  } catch (error) {
    if (reserved) await rmdir(target).catch(() => undefined); // Never remove concurrent user files.
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const target = args[0];
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const name = option('--name');
  if (!target || !name)
    throw new Error(
      'Usage: bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>]',
    );
  const manifest = await scaffold({ target, name, displayName: option('--display-name') });
  console.log(
    `Exported ${manifest.files.length} source files for ${manifest.application.name} to ${resolve(target)}`,
  );
}
