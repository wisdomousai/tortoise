import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeFile, listFiles } from './files';
import { parseBundleManifest, type BundleManifest } from './manifest';
import { verifyManifestSignature, type BundleSignature, type TrustedKey } from './signing';

/** A bundle that failed verification; the message says which check. */
export class BundleRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleRefused';
  }
}

/**
 * Verify a bundle directory before anything in it is used: the signature is by a trusted key over
 * the manifest as read, the manifest is well formed, and `files/` holds exactly the listed files
 * with the listed digests and sizes. Throws `BundleRefused` otherwise; returns the manifest.
 */
export async function verifyBundle(
  bundle: string,
  trusted: readonly TrustedKey[],
): Promise<BundleManifest> {
  let raw: unknown;
  let signature: BundleSignature;
  try {
    raw = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'));
    signature = JSON.parse(await readFile(join(bundle, 'bundle.sig'), 'utf8'));
  } catch {
    throw new BundleRefused('The bundle has no readable manifest or signature');
  }
  if (!(await verifyManifestSignature(raw, signature, trusted).catch(() => false)))
    throw new BundleRefused('The bundle signature is not from a trusted key');
  let manifest: BundleManifest;
  try {
    manifest = parseBundleManifest(raw);
  } catch (error) {
    throw new BundleRefused((error as Error).message);
  }
  const root = join(bundle, 'files');
  const present = await listFiles(root).catch((error: Error) => {
    throw new BundleRefused(error.message);
  });
  const listed = manifest.files.map((file) => file.path);
  if (present.join('\n') !== [...listed].sort().join('\n'))
    throw new BundleRefused('The bundle files differ from its manifest');
  for (const file of manifest.files) {
    const actual = await describeFile(root, file.path);
    if (actual.sha256 !== file.sha256 || actual.size !== file.size)
      throw new BundleRefused(`${file.path} does not match its digest`);
  }
  return manifest;
}
