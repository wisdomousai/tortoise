import { blobDigestPattern } from '@tortoise/contracts';
import type { BlobStore } from '@tortoise/runtime';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Blobs of one workspace in the app's document directory, in the same layout as the desktop:
 * `tortoise/<workspace>/blobs/sha256/<first two hex>/<rest>`. Each file is written under
 * `tmp` and moved into place, so a crash never leaves a partial blob under its digest. The file
 * system has no way to touch a file, so storing present bytes again rewrites them, which
 * refreshes `storedAt`.
 */
export function expoBlobStore(workspace: string): BlobStore {
  const root = new Directory(Paths.document, 'tortoise', workspace, 'blobs');
  const staging = new Directory(root, 'tmp');
  const digests = new Directory(root, 'sha256');
  const fileOf = (digest: string) => {
    if (!blobDigestPattern.test(digest)) throw new Error('Invalid blob digest');
    const hex = digest.slice('sha256:'.length);
    return new File(digests, hex.slice(0, 2), hex.slice(2));
  };
  return {
    async put(digest, data) {
      const target = fileOf(digest);
      if (!staging.exists) staging.create({ intermediates: true });
      const prefix = new Directory(digests, digest.slice(7, 9));
      if (!prefix.exists) prefix.create({ intermediates: true });
      const temporary = new File(staging, crypto.randomUUID());
      temporary.create();
      await temporary.write(data);
      await temporary.move(target, { overwrite: true });
    },
    async stat(digest) {
      const file = fileOf(digest);
      if (!file.exists) return undefined;
      return { size: file.size, storedAt: file.lastModified ?? 0 };
    },
    async get(digest) {
      const file = fileOf(digest);
      return file.exists ? await file.bytes() : undefined;
    },
    async remove(digest) {
      const file = fileOf(digest);
      if (file.exists) file.delete();
    },
    async list() {
      if (!digests.exists) return [];
      const found: string[] = [];
      for (const prefix of digests.list())
        if (prefix instanceof Directory)
          for (const file of prefix.list()) {
            const digest = `sha256:${prefix.name}${file.name}`;
            if (file instanceof File && blobDigestPattern.test(digest)) found.push(digest);
          }
      return found;
    },
  };
}
