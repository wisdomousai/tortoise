/**
 * The public surface of a workspace: each entrypoint in its `package.json` `exports`, with the
 * names that entrypoint exports, values and types alike. Skills describe how to use that surface,
 * so `check-skills` compares it with the surface they were last reviewed against
 * (`skills/reviewed-surface.json`). The scan reads TypeScript source as text and follows
 * `export * from` into local files; it never imports or runs workspace code. It is a reviewer's
 * signal, not a type checker, so the stamp and the check only need to agree with each other.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { rootScripts, surfaceWorkspaces } from './skills';

const sourceExtensions = ['.ts', '.tsx', '.js', '.mjs'];

function resolveModule(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier);
  for (const candidate of [
    base,
    ...sourceExtensions.map((extension) => `${base.replace(/\.js$/, '')}${extension}`),
    ...sourceExtensions.map((extension) => join(base, `index${extension}`)),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Names a module exports, following local `export * from` re-exports. */
export function exportedNames(file: string, seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  if (seen.has(file)) return names;
  seen.add(file);
  const text = withoutComments(readFileSync(file, 'utf8'));
  for (const [, alias, specifier] of text.matchAll(
    /export\s+(?:type\s+)?\*\s*(?:as\s+(\w+)\s*)?from\s*['"]([^'"]+)['"]/g,
  )) {
    if (alias) names.add(alias);
    else if (specifier!.startsWith('.')) {
      const target = resolveModule(file, specifier!);
      if (target) for (const name of exportedNames(target, seen)) names.add(name);
    } else names.add(`* from ${specifier}`);
  }
  for (const [, list] of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
    for (const item of list!.split(',')) {
      const name = item
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  for (const [, name] of text.matchAll(
    /export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(name!);
  if (/export\s+default\b/.test(text)) names.add('default');
  return names;
}

/** Every file an export map value names, with `*` patterns expanded within one directory. */
function entryFiles(directory: string, target: string): string[] {
  if (!target.includes('*')) {
    const file = join(directory, target);
    return existsSync(file) ? [file] : [];
  }
  const [prefix, suffix] = target.split('*') as [string, string];
  const folder = join(directory, dirname(`${prefix}x`));
  const start = prefix.slice(prefix.lastIndexOf('/') + 1);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.startsWith(start) && name.endsWith(suffix))
    .map((name) => join(folder, name))
    .sort();
}

const leaves = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(leaves)
      : [];

/**
 * `<entrypoint> <name>` lines for one workspace, sorted. A workspace without TypeScript
 * entrypoints (a driver SDK in another language) has an empty surface.
 */
export function surfaceOf(root: string, workspace: string): string[] {
  const directory = join(root, workspace);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
    exports?: unknown;
  };
  const exports =
    typeof manifest.exports === 'string' ? { '.': manifest.exports } : (manifest.exports ?? {});
  const lines = new Set<string>();
  for (const [subpath, value] of Object.entries(exports as Record<string, unknown>)) {
    if (subpath.endsWith('package.json')) continue;
    for (const target of new Set(leaves(value)))
      for (const file of entryFiles(directory, target)) {
        if (!sourceExtensions.some((extension) => file.endsWith(extension))) continue;
        const entry = subpath.includes('*')
          ? `./${relative(directory, file).replace(/\.[^.]+$/, '')}`
          : subpath;
        for (const name of exportedNames(file)) lines.add(`${entry} ${name}`);
      }
  }
  return [...lines].sort();
}

/** The surface of every tracked workspace, plus the root package scripts. */
export function currentSurface(root: string): Record<string, string[]> {
  const surface: Record<string, string[]> = {};
  for (const workspace of surfaceWorkspaces()) surface[workspace] = surfaceOf(root, workspace);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  surface[rootScripts] = Object.keys(manifest.scripts ?? {}).sort();
  return surface;
}
