import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { BundleFile } from './manifest';

/** Every regular file under `root`, as sorted `/`-separated relative paths. Links are refused. */
export async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(relative(root, path).split(sep).join('/'));
      else throw new Error(`Bundle payload holds a link or special file: ${entry.name}`);
    }
  }
  await walk(root);
  return found.sort();
}

export async function describeFile(root: string, path: string): Promise<BundleFile> {
  const bytes = await readFile(join(root, ...path.split('/')));
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}
