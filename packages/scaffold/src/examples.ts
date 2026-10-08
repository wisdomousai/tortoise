import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ExcludedExample {
  readonly directory: string;
  readonly packageName: string;
  readonly applicationId?: string;
}

/**
 * The examples a single-example export leaves out, with the package and application ids that
 * the root manifest, lockfile and generated references name. Reads text only; no content code
 * is loaded.
 */
export async function excludedExamples(
  sourceRoot: string,
  example: string,
): Promise<ExcludedExample[]> {
  const entries = await readdir(join(sourceRoot, 'examples'), { withFileTypes: true }).catch(
    () => [],
  );
  if (!entries.some((entry) => entry.isDirectory() && entry.name === example))
    throw new Error(`Unknown example "${example}"`);
  const excluded: ExcludedExample[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === example) continue;
    const directory = `examples/${entry.name}`;
    const manifest = JSON.parse(await readFile(join(sourceRoot, directory, 'package.json'), 'utf8'))
      .name as string;
    const id = (
      await readFile(join(sourceRoot, directory, 'manifest.ts'), 'utf8').catch(() => '')
    ).match(/\bid:\s*'([a-z0-9-]+)'/)?.[1];
    excluded.push({ directory, packageName: manifest, ...(id ? { applicationId: id } : {}) });
  }
  return excluded;
}

/** Drop excluded workspaces from Bun's text lockfile so `--frozen-lockfile` installs still pass. */
export function pruneLockfile(content: string, excluded: readonly ExcludedExample[]): string {
  let result = content;
  for (const { directory, packageName } of excluded) {
    const name = packageName.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const path = directory.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    result = result
      .replace(new RegExp(`\\n {8}"${name}": "workspace:\\*",`, 'g'), '')
      .replace(new RegExp(`\\n {4}"${path}": \\{[\\s\\S]*?\\n {4}\\},`), '')
      .replace(new RegExp(`\\n {4}"${name}": \\["${name}@workspace:${path}"\\],`), '');
  }
  return result;
}
