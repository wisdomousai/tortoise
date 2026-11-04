import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildCatalog,
  type AnyCapability,
  type BuildCatalogOptions,
  type CapabilityModule,
} from '@tortoise/contracts';

async function files(dir: string): Promise<string[]> {
  // A single screen file, such as a shared frame screen the application routes.
  if (/\.tsx$/.test(dir)) return [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? entry.name === 'node_modules' || entry.name === 'test'
          ? []
          : files(join(dir, entry.name))
        : /\.tsx$/.test(entry.name) && !entry.name.includes('.test.')
          ? [join(dir, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}

const isCapability = (value: unknown): value is AnyCapability =>
  typeof value === 'object' && value !== null && 'id' in value && 'kind' in value && 'ui' in value;

/**
 * Capabilities the screens under `source` invoke or read: every `<local>.<key>` in a `.tsx` file
 * where `<local>` is a named import from a contracts module or a feature's or plugin's manifest
 * entrypoint, and `<key>` names a capability on it.
 * `source` is a directory, a `.tsx` file, or several of them: an application that routes a
 * shared frame screen lists that screen's file next to its own directory. A reference is not
 * proof that a control renders, but an operation nothing in the UI references certainly has no
 * binding.
 */
export async function referencedCapabilities(
  source: string | readonly string[],
): Promise<Set<string>> {
  const referenced = new Set<string>();
  // A contracts module, or a feature's or plugin's browser-safe manifest entrypoint.
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*'([^']*(?:contracts|manifest))'/g;
  const sources = typeof source === 'string' ? [source] : source;
  for (const file of (await Promise.all(sources.map(files))).flat()) {
    const text = await readFile(file, 'utf8');
    for (const [, names, specifier] of text.matchAll(importPattern)) {
      const module = (await import(
        specifier!.startsWith('.') ? resolve(dirname(file), specifier!) : specifier!
      )) as Record<string, unknown>;
      for (const name of names!.split(',').map((part) => part.trim())) {
        if (!name || name.startsWith('type ')) continue;
        const [exported, local = exported] = name.split(/\s+as\s+/);
        const group = module[exported!];
        if (typeof group !== 'object' || group === null) continue;
        for (const [, key] of text.matchAll(new RegExp(`\\b${local}\\.(\\w+)\\b`, 'g'))) {
          const capability = (group as Record<string, unknown>)[key!];
          if (isCapability(capability)) referenced.add(capability.id);
        }
      }
    }
  }
  return referenced;
}

/**
 * Operations of `modules` that claim a UI binding but that no screen under `source` references.
 * An application's UI-binding test expects this to be empty. `options` passes the plugin
 * components when an operation forwards to a destination a plugin declares.
 */
export async function unboundOperations(
  modules: readonly CapabilityModule[],
  source: string | readonly string[],
  options: BuildCatalogOptions = {},
): Promise<string[]> {
  const referenced = await referencedCapabilities(source);
  return buildCatalog(modules, options)
    .operations.filter((operation) => operation.ui.binding && !referenced.has(operation.id))
    .map((operation) => operation.id);
}
