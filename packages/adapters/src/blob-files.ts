import { mkdir, open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { blobDigestPattern } from '@tortoise/contracts';
import type { BlobStore } from '@tortoise/runtime';

const missing = (error: unknown) => (error as { code?: string }).code === 'ENOENT';

/**
 * Blob store in a workspace directory: `<directory>/sha256/<first two hex>/<rest>`, each file
 * written under `<directory>/tmp`, synced and renamed into place, so a reader or a crash never
 * leaves a partial blob under its digest. Storing present bytes again only refreshes the file's
 * modification time, which is `storedAt`. Files are readable by the owner only.
 */
export function createFileBlobStore(directory: string): BlobStore {
  const root = join(directory, 'sha256');
  const staging = join(directory, 'tmp');
  const pathOf = (digest: string) => {
    if (!blobDigestPattern.test(digest)) throw new Error('Invalid blob digest');
    const hex = digest.slice('sha256:'.length);
    return join(root, hex.slice(0, 2), hex.slice(2));
  };
  return {
    async put(digest, data) {
      const path = pathOf(digest);
      const now = new Date();
      try {
        await utimes(path, now, now);
        return;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await mkdir(staging, { recursive: true, mode: 0o700 });
      const temporary = join(staging, crypto.randomUUID());
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    },
    async stat(digest) {
      try {
        const found = await stat(pathOf(digest));
        return { size: found.size, storedAt: found.mtimeMs };
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    },
    async get(digest) {
      try {
        return new Uint8Array(await readFile(pathOf(digest)));
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    },
    async remove(digest) {
      await rm(pathOf(digest), { force: true });
    },
    async list() {
      const digests: string[] = [];
      let prefixes: string[];
      try {
        prefixes = await readdir(root);
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
      for (const prefix of prefixes)
        for (const rest of await readdir(join(root, prefix))) {
          const digest = `sha256:${prefix}${rest}`;
          if (blobDigestPattern.test(digest)) digests.push(digest);
        }
      return digests;
    },
  };
}
