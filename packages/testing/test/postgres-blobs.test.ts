import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createPostgresBlobStore } from '@tortoise/adapters/postgres-blobs';
import { acquireWorkspaceLease } from '@tortoise/adapters/postgres-lease';
import { createMemoryBlobStore } from '@tortoise/runtime';
import { pgliteDriver } from '../src/postgres';

const digestOf = (data: Uint8Array) => `sha256:${bytesToHex(sha256(data))}`;

/** Blobs of a hosted workspace live in the shared database, so another instance reads them. */
test('two instances on one database share blobs and staging, and only the lease holder removes', async () => {
  const database = new PGlite();
  const a = pgliteDriver(database);
  const b = pgliteDriver(database);
  let now = 1_000;
  const first = createPostgresBlobStore(a, 'plant-1', { now: () => now });
  const data = new Uint8Array(70_000).map((_, index) => index % 251);
  const digest = digestOf(data);
  await first.put(digest, data);
  expect(await first.stat(digest)).toEqual({ size: 70_000, storedAt: 1_000 });
  now = 2_000;
  await first.put(digest, data);
  expect((await first.stat(digest))!.storedAt).toBe(2_000);

  // A takeover on another machine reads the same bytes and staging; another workspace does not.
  const lease = await acquireWorkspaceLease(b, 'plant-1', { ttlMs: 10_000 });
  const second = createPostgresBlobStore(b, 'plant-1', { fence: (tx) => lease.check(tx) });
  expect(await second.get(digest)).toEqual(data);
  expect(await second.list()).toEqual([digest]);
  expect(await createPostgresBlobStore(b, 'plant-2').get(digest)).toBeUndefined();
  await first.stage!('local\nada\n' + digest, 5_000);
  expect(await second.stagedUntil!('local\nada\n' + digest)).toBe(5_000);
  await second.unstage!(5_000);
  expect(await first.stagedUntil!('local\nada\n' + digest)).toBeUndefined();

  // After another instance takes the lease, the old holder's removal is refused.
  await lease.release();
  const taken = await acquireWorkspaceLease(a, 'plant-1', { ttlMs: 10_000 });
  await expect(second.remove(digest)).rejects.toThrow();
  expect(await first.get(digest)).toEqual(data);
  await createPostgresBlobStore(a, 'plant-1', { fence: (tx) => taken.check(tx) }).remove(digest);
  expect(await first.get(digest)).toBeUndefined();
  await taken.release();
  await database.close();
});

test('a blob stored in the local directory before the switch is read and copied in', async () => {
  const local = createMemoryBlobStore(() => 500);
  const data = new Uint8Array([9, 8, 7]);
  const digest = digestOf(data);
  await local.put(digest, data);
  const driver = pgliteDriver();
  const store = createPostgresBlobStore(driver, 'plant-1', { fallback: local });
  expect(await store.list()).toEqual([digest]);
  expect(await store.stat(digest)).toEqual({ size: 3, storedAt: 500 });
  await local.remove(digest);
  expect(await store.get(digest)).toEqual(data);
  await expect(store.get('sha256:../x')).rejects.toThrow('Invalid blob digest');
  await driver.close();
});
