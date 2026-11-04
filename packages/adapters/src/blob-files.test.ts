import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createFileBlobStore } from './blob-files';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function store() {
  const directory = mkdtempSync(join(tmpdir(), 'blobs-'));
  directories.push(directory);
  return { directory, blobs: createFileBlobStore(directory) };
}
const digestOf = (data: Uint8Array) => `sha256:${bytesToHex(sha256(data))}`;

test('blobs are stored by digest, listed, read back and removed', async () => {
  const { directory, blobs } = store();
  const data = new Uint8Array([1, 2, 3, 4]);
  const digest = digestOf(data);
  expect(await blobs.list()).toEqual([]);
  expect(await blobs.stat(digest)).toBeUndefined();
  await blobs.put(digest, data);
  const hex = digest.slice('sha256:'.length);
  const path = join(directory, 'sha256', hex.slice(0, 2), hex.slice(2));
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(join(directory, 'tmp'))).toEqual([]);
  expect(await blobs.list()).toEqual([digest]);
  expect((await blobs.stat(digest))?.size).toBe(4);
  expect(await blobs.get(digest)).toEqual(data);
  await blobs.remove(digest);
  expect(await blobs.get(digest)).toBeUndefined();
  await blobs.remove(digest);
});

test('storing present bytes again refreshes when they were stored', async () => {
  const { directory, blobs } = store();
  const data = new Uint8Array([5, 6]);
  const digest = digestOf(data);
  await blobs.put(digest, data);
  const hex = digest.slice('sha256:'.length);
  const old = new Date(Date.now() - 86_400_000);
  utimesSync(join(directory, 'sha256', hex.slice(0, 2), hex.slice(2)), old, old);
  expect((await blobs.stat(digest))!.storedAt).toBeLessThan(Date.now() - 3_600_000);
  await blobs.put(digest, data);
  expect((await blobs.stat(digest))!.storedAt).toBeGreaterThan(Date.now() - 60_000);
});

test('a digest that is not a SHA-256 reference never becomes a path', async () => {
  const { blobs } = store();
  await expect(blobs.get('sha256:../../etc/passwd')).rejects.toThrow('Invalid blob digest');
  await expect(blobs.put('md5:abc', new Uint8Array())).rejects.toThrow('Invalid blob digest');
});

test('staging records outlast the store object and name no principal', async () => {
  const { directory, blobs } = store();
  const key = 'local\nada@plant\nsha256:00';
  await blobs.stage!(key, 2_000);
  const reopened = createFileBlobStore(directory);
  expect(await reopened.stagedUntil!(key)).toBe(2_000);
  expect(await reopened.stagedUntil!('local\nben@plant\nsha256:00')).toBeUndefined();
  expect(readdirSync(join(directory, 'staged')).join()).not.toContain('ada');
  await reopened.unstage!(1_999);
  expect(await reopened.stagedUntil!(key)).toBe(2_000);
  await reopened.unstage!(2_000);
  expect(await reopened.stagedUntil!(key)).toBeUndefined();
});
