import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function files(root: string, directory = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(root, path)));
    else if (entry.isFile()) found.push(path);
    else throw new Error(`Model directory ${root} holds ${path}, which is not a file`);
  }
  return found;
}

/**
 * The `sha256:` digest of model weights as they are on disk. A file (a GGUF, a LoRA adapter) is
 * hashed as is. A directory (a Hugging Face checkout for vLLM) is hashed as the lines
 * `<sha256 hex>  <relative path>` of its files sorted by path, as `sha256sum` prints them, so
 * a renamed, added or changed file changes the digest. Links inside a directory are refused, so
 * the digest covers what the server reads.
 */
export async function measure(path: string): Promise<string> {
  const info = await stat(path);
  if (info.isFile()) return `sha256:${await fileDigest(path)}`;
  if (!info.isDirectory()) throw new Error(`${path} is neither a file nor a directory`);
  const lines: string[] = [];
  const paths = (await files(path))
    .map((file) => relative(path, file).split(sep).join('/'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of paths) lines.push(`${await fileDigest(join(path, name))}  ${name}\n`);
  return `sha256:${createHash('sha256').update(lines.join('')).digest('hex')}`;
}
