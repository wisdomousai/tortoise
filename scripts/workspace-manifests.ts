/**
 * The publishable workspaces (`packages/*`, `workstations/*` and `plugins/*`) and the manifest each must carry to
 * install from a registry: its own dependencies, worked out from what its published source
 * imports, the shared framework version, and which files it packs. Inside this checkout the root
 * manifest lists every dependency, so a missing entry here only fails for someone installing the
 * published package; `check:manifests` makes it fail here first. Reads files only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';

export const publishedLayers = ['packages', 'workstations', 'plugins'] as const;

/** Packed into every published package: everything except tests and development scripts. */
export const publishedFiles = [
  '**/*',
  '!test/**',
  '!scripts/**',
  '!**/*.test.ts',
  '!**/*.test.tsx',
] as const;

/**
 * Dependencies the application must install once, so a framework package names them as peers:
 * React and React Native, Expo modules, and the build tools (from the root's dev dependencies)
 * that only some entrypoints use, such as Vite for `@tortoise/frame/vite`.
 */
const singleCopy = /^(?:react|react-dom|react-native|react-native-.+|expo|expo-.+)$/;

export interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  repository?: { type: string; url: string; directory: string };
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
  [key: string]: unknown;
}

export interface Workspace {
  readonly directory: string;
  readonly manifest: Manifest;
}

const readJson = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (record: Record<string, string>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => byCode(a, b)));

export function workspaces(root: string, layers: readonly string[]): Workspace[] {
  const found: Workspace[] = [];
  for (const layer of layers) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, layer)).sort();
    } catch {
      continue; // An application installed from a registry has no framework source.
    }
    for (const entry of entries) {
      const path = join(root, layer, entry, 'package.json');
      try {
        found.push({ directory: `${layer}/${entry}`, manifest: readJson<Manifest>(path) });
      } catch {
        // Not a workspace.
      }
    }
  }
  return found;
}

const excludedPath = (path: string) =>
  /(?:^|\/)(?:node_modules|test|scripts)(?:\/|$)/.test(path) || /\.test\.tsx?$/.test(path);

/** Source files a published package ships, relative to its directory. */
function publishedSources(directory: string): string[] {
  const files: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(join(directory, path))) {
      const child = path ? `${path}/${entry}` : entry;
      if (excludedPath(child)) continue;
      if (statSync(join(directory, child)).isDirectory()) walk(child);
      else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry)) files.push(child);
    }
  };
  walk('');
  return files;
}

const specifierPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire(?:\.resolve)?\s*\(\s*|@import\s+)['"]([^'"\n]+)['"]/g;

/** The package a bare module specifier names, or undefined for relative, aliased and built-ins. */
export function packageOf(specifier: string): string | undefined {
  if (/^(?:\.|\/|@\/|node:|bun:|virtual:|#)/.test(specifier) || specifier === 'bun') return;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return isBuiltin(name) ? undefined : name;
}

/** Every package the published files of `directory` import, without itself. */
export function importedPackages(root: string, workspace: Workspace): Set<string> {
  const directory = join(root, workspace.directory);
  const names = new Set<string>();
  for (const file of publishedSources(directory)) {
    // Comments, template literals and double-quoted strings (imports are single-quoted here)
    // are dropped first, so a JSDoc example or generated source naming a package is not a
    // dependency.
    const source = readFileSync(join(directory, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
      .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
    // JSX compiles to imports of `react/jsx-runtime`.
    if (file.endsWith('.tsx')) names.add('react');
    for (const [, specifier] of source.matchAll(specifierPattern)) {
      const name = packageOf(specifier!);
      if (name && name !== workspace.manifest.name) names.add(name);
    }
  }
  return names;
}

interface RootManifest {
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * The manifest `workspace` should have: its dependencies from its imports (framework packages as
 * `workspace:*`, which packing turns into the exact shared version), the repository directory the
 * browser boundary uses to place an installed file, and the packed file list. Problems that a
 * rewrite cannot fix, such as an import the root does not list, are returned instead.
 */
export function expectedManifest(
  root: string,
  workspace: Workspace,
  published: ReadonlyMap<string, Workspace>,
  repositoryUrl: string,
): { manifest: Manifest; problems: string[] } {
  const rootManifest = readJson<RootManifest>(join(root, 'package.json'));
  const dependencies: Record<string, string> = {};
  const peers: Record<string, string> = {};
  const optional: Record<string, { optional: boolean }> = {};
  const problems: string[] = [];
  for (const name of [...importedPackages(root, workspace)].sort(byCode)) {
    if (published.has(name)) dependencies[name] = 'workspace:*';
    else if (name.startsWith('@tortoise/'))
      problems.push(`imports ${name}, which is not a published framework package`);
    else if (rootManifest.dependencies?.[name])
      (singleCopy.test(name) ? peers : dependencies)[name] = rootManifest.dependencies[name]!;
    else if (rootManifest.devDependencies?.[name]) {
      peers[name] = rootManifest.devDependencies[name]!;
      optional[name] = { optional: true };
    } else problems.push(`imports ${name}, which the root manifest does not list`);
  }
  const {
    dependencies: _dependencies,
    peerDependencies: _peers,
    peerDependenciesMeta: _meta,
    private: _private,
    ...rest
  } = workspace.manifest;
  // Every package carries the repository's license; `release.ts pack` adds its text.
  if (!rootManifest.license) problems.push('the root manifest needs a license');
  const manifest: Manifest = {
    ...rest,
    ...(rootManifest.license ? { license: rootManifest.license } : {}),
    repository: { type: 'git', url: repositoryUrl, directory: workspace.directory },
    files: [...publishedFiles],
    ...(Object.keys(dependencies).length ? { dependencies: sorted(dependencies) } : {}),
    ...(Object.keys(peers).length ? { peerDependencies: sorted(peers) } : {}),
    ...(Object.keys(optional).length ? { peerDependenciesMeta: optional } : {}),
  };
  return { manifest, problems };
}
