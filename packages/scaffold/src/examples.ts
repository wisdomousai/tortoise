import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Directories that hold applications: the examples and the concept patterns. */
const contentLayers = ['showcase/examples', 'showcase/patterns'] as const;

export interface ExcludedExample {
  readonly directory: string;
  readonly packageName: string;
  readonly applicationId?: string;
}

/** Source files of one example, skipping installed and generated directories. */
async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'generated'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Whether `source` names `packageName` or one of its subpaths as a module specifier. */
const imports = (source: string, packageName: string) =>
  source.includes(`'${packageName}'`) ||
  source.includes(`'${packageName}/`) ||
  source.includes(`"${packageName}"`) ||
  source.includes(`"${packageName}/`);

/**
 * `keep` and every example it imports, transitively, such as a field app that shares its hub's
 * domain modules.
 */
async function keptExamples(
  sourceRoot: string,
  examples: readonly ExcludedExample[],
  keep: string,
): Promise<Set<string>> {
  const kept = new Set([`showcase/examples/${keep}`]);
  const pending = [`showcase/examples/${keep}`];
  while (pending.length) {
    const files = await sourceFiles(join(sourceRoot, pending.pop()!));
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    for (const example of examples)
      if (
        !kept.has(example.directory) &&
        sources.some((text) => imports(text, example.packageName))
      ) {
        kept.add(example.directory);
        pending.push(example.directory);
      }
  }
  return kept;
}

/**
 * The examples and patterns an export leaves out, with the package and application ids that the
 * root manifest, lockfile and generated references name: every one except the example `keep` and
 * those it imports, or all of them when `keep` is undefined (a new application). Reads text only;
 * no content code is loaded.
 */
export async function excludedExamples(
  sourceRoot: string,
  keep: string | undefined,
): Promise<ExcludedExample[]> {
  const examples: ExcludedExample[] = [];
  for (const layer of contentLayers) {
    const entries = await readdir(join(sourceRoot, layer), { withFileTypes: true }).catch(() => []);
    if (
      layer === 'showcase/examples' &&
      keep !== undefined &&
      !entries.some((entry) => entry.isDirectory() && entry.name === keep)
    )
      throw new Error(`Unknown example "${keep}"`);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = `${layer}/${entry.name}`;
      const manifest = JSON.parse(
        await readFile(join(sourceRoot, directory, 'package.json'), 'utf8'),
      ).name as string;
      const id = (
        await readFile(join(sourceRoot, directory, 'manifest.ts'), 'utf8').catch(() => '')
      ).match(/\bid:\s*'([a-z0-9-]+)'/)?.[1];
      examples.push({ directory, packageName: manifest, ...(id ? { applicationId: id } : {}) });
    }
  }
  const kept = keep === undefined ? new Set() : await keptExamples(sourceRoot, examples, keep);
  return examples.filter((example) => !kept.has(example.directory));
}

/**
 * The `showcase/patterns/*` workspace entry when the export leaves out every pattern, so the
 * exported root lists no empty layer. The examples layer always stays: it holds the application.
 */
export async function emptiedLayers(
  sourceRoot: string,
  excluded: readonly ExcludedExample[],
): Promise<string[]> {
  const entries = await readdir(join(sourceRoot, 'showcase', 'patterns'), {
    withFileTypes: true,
  }).catch(() => []);
  const patterns = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return patterns.every((name) =>
    excluded.some(({ directory }) => directory === `showcase/patterns/${name}`),
  )
    ? ['showcase/patterns/*']
    : [];
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
