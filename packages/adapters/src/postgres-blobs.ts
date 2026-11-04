import { createHash } from 'node:crypto';
import { blobDigestPattern } from '@tortoise/contracts';
import type { BlobStore } from '@tortoise/runtime';
import type { PgDriver, PgQuery } from './postgres/driver';
import { openPgSchema } from './postgres/schema';

export interface PostgresBlobStoreOptions {
  /** Checked inside each removal's transaction, so an instance that lost the lease removes nothing. */
  readonly fence?: (tx: PgQuery) => Promise<void>;
  /**
   * The store the workspace used before, such as the local directory. A blob missing here is read
   * from it and copied in, so blobs stored before a switch to Postgres stay readable.
   */
  readonly fallback?: BlobStore;
  readonly now?: () => number;
}

const keyOf = (key: string) => createHash('sha256').update(key).digest('hex');
const valid = (digest: string) => {
  if (!blobDigestPattern.test(digest)) throw new Error('Invalid blob digest');
  return digest;
};

/**
 * A workspace's blobs in the shared Postgres database (`workspace_blobs`, `BYTEA`), so a hosted
 * instance that takes over the lease on another machine reads the same attachments. Bytes travel
 * base64-encoded as text parameters, which every `PgDriver` binds, at a third more size on the
 * wire; `maxBlobBytes` bounds a blob at 256 MiB. Staging records keep the SHA-256 of their key.
 */
export function createPostgresBlobStore(
  driver: PgDriver,
  workspace: string,
  options: PostgresBlobStoreOptions = {},
): BlobStore {
  const now = options.now ?? Date.now;
  let schema: Promise<void> | undefined;
  const run = async <T>(fn: (tx: PgQuery) => Promise<T>) => {
    schema ??= openPgSchema(driver).catch((error: unknown) => {
      schema = undefined;
      throw error;
    });
    await schema;
    return driver.transaction(fn);
  };
  const fallback = options.fallback;
  /** Copy a blob the previous store has into this one, keeping when it was stored. */
  async function adopt(digest: string) {
    const stored = fallback && (await fallback.stat(digest));
    const data = stored && (await fallback.get(digest));
    if (!stored || !data) return undefined;
    await run((tx) =>
      tx.query(
        `INSERT INTO workspace_blobs VALUES ($1, $2, decode($3, 'base64'), $4, $5)
         ON CONFLICT (workspace_id, digest) DO NOTHING`,
        [workspace, digest, Buffer.from(data).toString('base64'), data.byteLength, stored.storedAt],
      ),
    );
    return { data, stored };
  }
  return {
    async put(digest, data) {
      await run((tx) =>
        tx.query(
          `INSERT INTO workspace_blobs VALUES ($1, $2, decode($3, 'base64'), $4, $5)
           ON CONFLICT (workspace_id, digest) DO UPDATE SET stored_at = excluded.stored_at`,
          [workspace, valid(digest), Buffer.from(data).toString('base64'), data.byteLength, now()],
        ),
      );
    },
    async stat(digest) {
      const [row] = await run((tx) =>
        tx.query<{ size: string | number; stored_at: string | number }>(
          'SELECT size, stored_at FROM workspace_blobs WHERE workspace_id = $1 AND digest = $2',
          [workspace, valid(digest)],
        ),
      );
      if (row) return { size: Number(row.size), storedAt: Number(row.stored_at) };
      const adopted = await adopt(digest);
      return adopted && { size: adopted.data.byteLength, storedAt: adopted.stored.storedAt };
    },
    async get(digest) {
      const [row] = await run((tx) =>
        tx.query<{ data: string }>(
          "SELECT encode(data, 'base64') AS data FROM workspace_blobs WHERE workspace_id = $1 AND digest = $2",
          [workspace, valid(digest)],
        ),
      );
      if (row) return new Uint8Array(Buffer.from(row.data.replaceAll('\n', ''), 'base64'));
      return (await adopt(digest))?.data;
    },
    async remove(digest) {
      await run(async (tx) => {
        await options.fence?.(tx);
        await tx.query('DELETE FROM workspace_blobs WHERE workspace_id = $1 AND digest = $2', [
          workspace,
          valid(digest),
        ]);
      });
      await fallback?.remove(digest);
    },
    async list() {
      const rows = await run((tx) =>
        tx.query<{ digest: string }>(
          'SELECT digest FROM workspace_blobs WHERE workspace_id = $1 ORDER BY digest',
          [workspace],
        ),
      );
      const digests = new Set(rows.map((row) => row.digest));
      for (const digest of (await fallback?.list()) ?? []) digests.add(digest);
      return [...digests];
    },
    async stage(key, until) {
      await run((tx) =>
        tx.query(
          `INSERT INTO workspace_blob_staging VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, key) DO UPDATE SET until = excluded.until`,
          [workspace, keyOf(key), until],
        ),
      );
    },
    async stagedUntil(key) {
      const [row] = await run((tx) =>
        tx.query<{ until: string | number }>(
          'SELECT until FROM workspace_blob_staging WHERE workspace_id = $1 AND key = $2',
          [workspace, keyOf(key)],
        ),
      );
      return row ? Number(row.until) : undefined;
    },
    async unstage(at) {
      await run((tx) =>
        tx.query('DELETE FROM workspace_blob_staging WHERE workspace_id = $1 AND until <= $2', [
          workspace,
          at,
        ]),
      );
    },
  };
}
