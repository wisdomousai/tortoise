import type { BlobStore, ExecutionContext } from '../types.js';

/**
 * Recent uploads, per workspace and principal, and a per-workspace lock that keeps a store write
 * and a sweep apart. A blob may be attached by the principal that uploaded it until `graceMs`
 * after the upload; after that only a caller who can already read it may attach it. Kept in
 * memory, and in the blob store when it keeps staging (`BlobStore.stage`), so an upload stays
 * attachable by its uploader across a restart.
 */
export function createUploads(now: () => number, graceMs: number) {
  const staged = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();
  const key = (context: ExecutionContext, digest: string) =>
    `${context.workspaceId}\n${context.principalId}\n${digest}`;
  const prune = () => {
    const at = now();
    for (const [entry, expiresAt] of staged) if (expiresAt <= at) staged.delete(entry);
  };
  return {
    graceMs,
    async stage(context: ExecutionContext, digest: string, store: BlobStore) {
      prune();
      const until = now() + graceMs;
      staged.set(key(context, digest), until);
      await store.stage?.(key(context, digest), until);
    },
    async isStaged(context: ExecutionContext, digest: string, store: BlobStore) {
      const expiresAt =
        staged.get(key(context, digest)) ?? (await store.stagedUntil?.(key(context, digest)));
      return expiresAt !== undefined && expiresAt > now();
    },
    /** Run `action` after every earlier action on this workspace's store has completed. */
    async exclusive<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
      const previous = tails.get(workspaceId) ?? Promise.resolve();
      let unlock!: () => void;
      const tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      tails.set(workspaceId, tail);
      await previous;
      try {
        return await action();
      } finally {
        unlock();
        if (tails.get(workspaceId) === tail) tails.delete(workspaceId);
      }
    },
  };
}
export type Uploads = ReturnType<typeof createUploads>;
