import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeFile, listFiles } from './files';
import { parseBundleManifest, type BundleManifest } from './manifest';
import { signManifest, type SigningKey } from './signing';

export type BundleDescription = Omit<BundleManifest, 'format' | 'files' | 'createdAt'> & {
  readonly createdAt?: string;
};

/**
 * Write a bundle directory at `out`: the payload copied to `files/`, `bundle.json` listing every
 * file with its SHA-256 and size, and `bundle.sig` with the Ed25519 signature over the canonical
 * manifest. `out` must not exist. Fails on a link or special file in the payload.
 */
export async function createBundle(
  payload: string,
  out: string,
  description: BundleDescription,
  key: SigningKey,
): Promise<BundleManifest> {
  await mkdir(out, { recursive: false });
  const files = join(out, 'files');
  await cp(payload, files, { recursive: true, verbatimSymlinks: true });
  const listed = await Promise.all(
    (await listFiles(files)).map((path) => describeFile(files, path)),
  );
  const manifest = parseBundleManifest({
    format: 1,
    ...description,
    createdAt: description.createdAt ?? new Date().toISOString(),
    files: listed,
  });
  await writeFile(join(out, 'bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(out, 'bundle.sig'),
    `${JSON.stringify(await signManifest(manifest, key))}\n`,
  );
  return manifest;
}
