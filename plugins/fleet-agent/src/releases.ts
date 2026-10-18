import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  parseBundleManifest,
  verifyBundle,
  type BundleManifest,
  type TrustedKey,
} from '@agent-native/bundle';
import type { FleetRelease } from './contracts';
import type { FleetLink } from './link';

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Fetch `release` into `folder/<release id>` and verify it as `site install` will: the signature
 * by a key in `trusted`, and every file against the manifest's digest and size. Each file is
 * checked as it arrives and written under a temporary directory, which is renamed into place only
 * once the whole bundle verifies, so the folder never holds a partial or unverified release.
 * Activation is not done here: the operator's `site install` (or a timer that runs it) installs
 * a staged release, so the instance never replaces itself.
 */
export async function stageRelease(
  link: FleetLink,
  folder: string,
  trusted: readonly TrustedKey[],
  release: FleetRelease,
): Promise<{ readonly path: string; readonly manifest: BundleManifest; readonly fresh: boolean }> {
  if (!safeId.test(release.id)) throw new Error(`Release ID ${release.id} is not a safe name`);
  const target = join(folder, release.id);
  if (await exists(join(target, 'bundle.json')))
    return { path: target, manifest: await verifyBundle(target, trusted), fresh: false };
  const manifest = parseBundleManifest(release.manifest);
  const partial = join(folder, `.${release.id}.partial`);
  await rm(partial, { recursive: true, force: true });
  try {
    for (const file of manifest.files) {
      const bytes = await link.blob(`sha256:${file.sha256}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== file.sha256 || bytes.byteLength !== file.size)
        throw new Error(`The fleet sent ${file.path} with another digest`);
      const path = join(partial, 'files', ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    await mkdir(join(partial, 'files'), { recursive: true });
    await writeFile(join(partial, 'bundle.json'), JSON.stringify(release.manifest));
    await writeFile(join(partial, 'bundle.sig'), JSON.stringify(release.signature));
    const verified = await verifyBundle(partial, trusted);
    await rename(partial, target);
    return { path: target, manifest: verified, fresh: true };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}
