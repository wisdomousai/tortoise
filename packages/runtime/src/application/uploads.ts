import type { ExecutionContext } from '../types.js';

/**
 * Recent uploads, per workspace and principal, and a per-workspace lock that keeps a store write
 * and a sweep apart. A blob may be attached by the principal that uploaded it until `graceMs`
 * after the upload; after that only a caller who can already read it may attach it. Kept in
 * memory: after a restart, uploads that were never attached must be uploaded again.
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
    stage(context: ExecutionContext, digest: string) {
      prune();
      staged.set(key(context, digest), now() + graceMs);
    },
    isStaged(context: ExecutionContext, digest: string) {
      const expiresAt = staged.get(key(context, digest));
      return expiresAt !== undefined && expiresAt > now();
    },
    /** Run `action` after every earlier action on this workspace's store has settled. */
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
