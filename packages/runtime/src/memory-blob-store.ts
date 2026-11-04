import type { BlobStore } from './types.js';

/**
 * Reference blob store in memory, for tests and hosts without durable files. Keeps isolated
 * copies, so a caller that changes its buffer after `put` or `get` cannot change a stored blob.
 */
export function createMemoryBlobStore(now: () => number = Date.now): BlobStore {
  const blobs = new Map<string, { readonly data: Uint8Array; readonly storedAt: number }>();
  const staged = new Map<string, number>();
  return {
    async put(digest, data) {
      blobs.set(digest, { data: data.slice(), storedAt: now() });
    },
    async stat(digest) {
      const blob = blobs.get(digest);
      return blob && { size: blob.data.byteLength, storedAt: blob.storedAt };
    },
    async get(digest) {
      return blobs.get(digest)?.data.slice();
    },
    async remove(digest) {
      blobs.delete(digest);
    },
    async list() {
      return [...blobs.keys()];
    },
    async stage(key, until) {
      staged.set(key, until);
    },
    async stagedUntil(key) {
      return staged.get(key);
    },
    async unstage(at) {
      for (const [key, until] of staged) if (until <= at) staged.delete(key);
    },
  };
}
