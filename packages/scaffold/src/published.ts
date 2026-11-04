import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prettierJson } from './json';

/**
 * An export that installs the framework from a registry instead of vendoring it: the starter and
 * the content are copied, `packages/*`, `workstations/*`, `plugins/*` and `sdks/*` are not, the root depends on
 * every framework package at the checkout's framework version, and the starter's references to
 * framework files point into `node_modules`.
 */
export interface PublishedFramework {
  /** The framework version every `@tortoise` package is installed at. */
  readonly version: string;
  /** Workspace directory to package name, for example `packages/frame` to `@tortoise/frame`. */
  readonly packages: ReadonlyMap<string, string>;
  /** Registry for the `@tortoise` scope, written to `bunfig.toml`; npm's default otherwise. */
  readonly registry?: string;
}

/** Framework layers left out; driver SDKs are other languages' packages, not published here. */
const frameworkDirectories = ['packages/', 'workstations/', 'plugins/', 'sdks/'];

/** Scripts that build, check or release framework source, which the export does not contain. */
const frameworkScripts = new Set([
  'scripts/build-operator-registry.ts',
  'scripts/check-manifests.ts',
  'scripts/workspace-manifests.ts',
  'scripts/release.ts',
  'scripts/local-registry.ts',
  // Framework coverage and reviewed exports belong to the source checkout. An installed-framework
  // application can create its own registry and stamp if it adds a local workspace.
  'scripts/reviewed-surface.json',
  'scripts/skill-coverage.json',
  'scripts/check-skills.test.ts',
]);

/** Whether a published-framework export leaves `path` out. */
export const frameworkFile = (path: string) =>
  path === 'bun.lock' ||
  frameworkScripts.has(path) ||
  frameworkDirectories.some((prefix) => path.startsWith(prefix));

/** The published framework workspaces of a checkout and their shared version. */
export async function publishedFramework(
  sourceRoot: string,
  registry?: string,
): Promise<PublishedFramework> {
  const packages = new Map<string, string>();
  const versions = new Set<string>();
  for (const layer of ['packages', 'workstations', 'plugins'])
    for (const entry of await readdir(join(sourceRoot, layer)).catch(() => [])) {
      const manifest = await readFile(join(sourceRoot, layer, entry, 'package.json'), 'utf8')
        .then((text) => JSON.parse(text) as { name: string; version: string; private?: boolean })
        .catch(() => undefined);
      if (!manifest || manifest.private) continue;
      packages.set(`${layer}/${entry}`, manifest.name);
      versions.add(manifest.version);
    }
  if (!packages.size) throw new Error('The source checkout has no publishable framework packages');
  if (versions.size !== 1)
    throw new Error(`Framework packages have more than one version: ${[...versions].join(', ')}`);
  if (registry !== undefined && !/^https?:\/\/[^\s"]+$/.test(registry))
    throw new Error('Registry must be an http or https URL');
  return { version: [...versions][0]!, packages, ...(registry ? { registry } : {}) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Point relative references to framework workspaces (`../../packages/frame/src`, or
 * `./packages/frame` in the root tsconfig) and root-relative Markdown links at the installed
 * package. Bare paths in code, such as boundary rule patterns, stay as they are.
 */
function installedPaths(content: string, framework: PublishedFramework, markdown: boolean): string {
  let result = content;
  for (const [directory, name] of framework.packages) {
    const path = escape(directory);
    result = result.replace(
      new RegExp(`((?:\\.\\.?/)+)${path}(?=[/'"\\s)*]|$)`, 'gm'),
      `$1node_modules/${name}`,
    );
    if (markdown)
      result = result.replace(new RegExp(`\\]\\(${path}(?=[/)#])`, 'g'), `](node_modules/${name}`);
  }
  return result;
}

interface RootManifest {
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Root scripts without the ones `drop` names, and without every `bun run` of a dropped script
 * inside a chain such as `check`, so the chain runs what is left.
 */
export function pruneScripts(
  scripts: Readonly<Record<string, string>>,
  drop: (name: string, command: string) => boolean,
): Record<string, string> {
  const dropped = new Set(
    Object.entries(scripts)
      .filter(([name, command]) => drop(name, command))
      .map(([name]) => name),
  );
  const result: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (dropped.has(name)) continue;
    const steps = command
      .split(' && ')
      .filter((step) => !dropped.has(/^bun run (\S+)$/.exec(step)?.[1] ?? ''));
    if (steps.length) result[name] = steps.join(' && ');
  }
  return result;
}

/**
 * Root scripts for an export without framework source. A script that tests framework source,
 * builds a registry from it or releases it is dropped; other references to framework files,
 * such as `bun packages/scaffold/src/cli.ts`, run the installed copy.
 */
function publishedScripts(
  scripts: Readonly<Record<string, string>>,
  framework: PublishedFramework,
): Record<string, string> {
  const framed = new RegExp(`(?:^|[\\s=])(?:\\./)?(?:${frameworkDirectories.join('|')})`);
  const pruned = pruneScripts(
    scripts,
    (name, command) =>
      (/\bbun test\b|--cwd |--preload /.test(command) && framed.test(command)) ||
      [...frameworkScripts].some((path) => command.includes(path)) ||
      name === 'changeset' ||
      name.startsWith('release:'),
  );
  return Object.fromEntries(
    Object.entries(pruned).map(([name, command]) => {
      let rewritten = command;
      for (const [directory, packageName] of framework.packages)
        rewritten = rewritten.replace(
          new RegExp(`(^|\\s)(?:\\./)?${escape(directory)}(?=/)`, 'g'),
          `$1node_modules/${packageName}`,
        );
      return [name, rewritten];
    }),
  );
}

function publishedRoot(content: string, framework: PublishedFramework): string {
  const root = JSON.parse(content) as RootManifest;
  root.workspaces = (root.workspaces ?? []).filter(
    (pattern) => !frameworkDirectories.some((prefix) => pattern.startsWith(prefix)),
  );
  if (root.scripts) root.scripts = publishedScripts(root.scripts, framework);
  const names = new Set(framework.packages.values());
  const dependencies = Object.entries(root.dependencies ?? {}).map(([name, range]) =>
    names.has(name) ? ([name, framework.version] as const) : ([name, range] as const),
  );
  root.dependencies = Object.fromEntries(dependencies.sort(([a], [b]) => byCode(a, b)));
  if (root.devDependencies) delete root.devDependencies['@changesets/cli'];
  delete root.repository;
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * A tsconfig without framework source: its framework include and exclude entries are dropped,
 * since the installed packages are compiled where the application imports them, and path
 * aliases into a framework workspace point at the installed package.
 */
function publishedTsconfig(content: string, framework: PublishedFramework): string {
  const config = JSON.parse(installedPaths(content, framework, false)) as {
    include?: string[];
    exclude?: string[];
  };
  const framed = (entry: string) =>
    frameworkDirectories.some(
      (prefix) => entry === prefix.slice(0, -1) || entry.startsWith(prefix),
    );
  if (config.include) config.include = config.include.filter((entry) => !framed(entry));
  if (config.exclude) config.exclude = config.exclude.filter((entry) => !framed(entry));
  return `${prettierJson(config)}\n`;
}

/** Rewrite one exported text file for an export that installs the framework. */
export function publishedContent(
  path: string,
  content: string,
  framework: PublishedFramework,
): string {
  if (path === 'package.json') return publishedRoot(content, framework);
  if (path === 'tsconfig.json' || path === 'tsconfig.native.json')
    return publishedTsconfig(content, framework);
  const rewritten = installedPaths(content, framework, path.endsWith('.md'));
  // A longer path can push a JSON line past the print width; write it as Prettier would.
  return rewritten !== content && path.endsWith('.json') && !path.endsWith('package.json')
    ? `${prettierJson(JSON.parse(rewritten))}\n`
    : rewritten;
}

/** Files only an installed-framework export has. */
export function publishedFiles(framework: PublishedFramework): Record<string, string> {
  return framework.registry
    ? {
        'bunfig.toml': `# Framework packages install from this registry; everything else from npm.\n[install.scopes]\n"@tortoise" = ${JSON.stringify(framework.registry)}\n`,
      }
    : {};
}
