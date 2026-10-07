import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildCatalog, type AnyCapability } from '@agent-native/contracts';
import { applicationModules } from '../service/src/modules';

const source = resolve(import.meta.dir, 'src');

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : /\.tsx?$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}

const isCapability = (value: unknown): value is AnyCapability =>
  typeof value === 'object' && value !== null && 'id' in value && 'kind' in value && 'ui' in value;

/**
 * Capabilities the web UI invokes or reads: every `<local>.<key>` where `<local>` is a named
 * import from a contracts module and `<key>` names a capability on it. A reference is not proof
 * that a control renders, but an operation nothing in the UI references certainly has no binding.
 */
async function referencedCapabilities(): Promise<Set<string>> {
  const referenced = new Set<string>();
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*'([^']*contracts)'/g;
  for (const file of await files(source)) {
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

test('every operation that claims a UI binding is referenced by a screen', async () => {
  const referenced = await referencedCapabilities();
  const unbound = buildCatalog(applicationModules)
    .operations.filter((operation) => operation.ui.binding && !referenced.has(operation.id))
    .map((operation) => operation.id);
  expect(unbound).toEqual([]);
});
