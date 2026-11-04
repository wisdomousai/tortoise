import { readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export interface InstalledFramework {
  /** Each installed framework version with the packages found at it. */
  readonly versions: Readonly<Record<string, readonly string[]>>;
  /** Present when more than one version is installed. */
  readonly problem?: string;
}

const SCOPE = '@tortoise';

async function entries(directory: string): Promise<string[]> {
  return readdir(directory).catch(() => []);
}

/**
 * Every published framework package installed under `root`, by version. Framework packages
 * depend on each other at one exact version, so two versions mean an application pinned a
 * package apart from the rest, and a value or type from one copy no longer matches the other's.
 * Walks `node_modules` (nested copies and Bun's `.bun` store included); private workspaces
 * such as applications and examples are not framework packages and are skipped.
 */
export async function installedFramework(root: string): Promise<InstalledFramework> {
  const versions = new Map<string, Set<string>>();
  const seen = new Set<string>();
  async function scan(modules: string) {
    let real: string;
    try {
      real = await realpath(modules);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of await entries(join(modules, SCOPE))) {
      const manifest = await readFile(join(modules, SCOPE, name, 'package.json'), 'utf8').then(
        (text) => JSON.parse(text) as { name?: string; version?: string; private?: boolean },
        () => undefined,
      );
      if (!manifest?.name || !manifest.version || manifest.private) continue;
      versions.set(
        manifest.version,
        (versions.get(manifest.version) ?? new Set()).add(manifest.name),
      );
    }
    for (const entry of await entries(modules)) {
      if (entry === '.bin') continue;
      const packages =
        entry.startsWith('@') || entry === '.bun'
          ? (await entries(join(modules, entry))).map((child) => join(modules, entry, child))
          : [join(modules, entry)];
      for (const directory of packages) await scan(join(directory, 'node_modules'));
    }
  }
  await scan(join(root, 'node_modules'));
  const result = Object.fromEntries(
    [...versions]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([version, names]) => [version, [...names].sort()]),
  );
  return versions.size > 1
    ? {
        versions: result,
        problem: `Mixed framework versions installed: ${Object.entries(result)
          .map(([version, names]) => `${version} (${names.join(', ')})`)
          .join('; ')}. Depend on every @tortoise package at the same version.`,
      }
    : { versions: result };
}
