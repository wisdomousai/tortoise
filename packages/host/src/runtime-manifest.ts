import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const desktopTargets = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'] as const;
export type DesktopTarget = (typeof desktopTargets)[number];
export interface RuntimeManifest {
  format: 1;
  target: DesktopTarget;
  service: { executable: string; sha256: string };
  webRoot: string;
  /**
   * Deployment policy shipped with this build: which declared destinations the packaged app may reach.
   * Digest-checked at launch like the service executable, so a swapped file is refused.
   */
  deploymentPolicy?: { path: string; sha256: string };
  runtimes: Record<
    'codex' | 'claude',
    { executable: string; version: string; files: { path: string; sha256: string }[] }
  >;
}
/** Reject resource traversal before resolving an executable supplied by a manifest. */
export function resourcePath(root: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error('Resource path must be relative');
  const absolute = resolve(root, path);
  const fromRoot = relative(resolve(root), absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error('Resource path escapes its packaged root');
  return absolute;
}
export async function loadRuntimeManifest(root: string): Promise<RuntimeManifest> {
  const manifest: RuntimeManifest = JSON.parse(
    await readFile(resolve(root, 'runtime-manifest.json'), 'utf8'),
  );
  if (
    manifest.format !== 1 ||
    !desktopTargets.includes(manifest.target) ||
    !manifest.runtimes?.codex ||
    !manifest.runtimes?.claude
  )
    throw new Error('Invalid runtime manifest');
  if (manifest.target !== `${process.platform}-${process.arch}`)
    throw new Error(`Packaged runtime target mismatch: ${manifest.target}`);
  for (const asset of [manifest.service, ...Object.values(manifest.runtimes)])
    resourcePath(root, asset.executable);
  for (const runtime of Object.values(manifest.runtimes)) {
    if (
      !Array.isArray(runtime.files) ||
      runtime.files.filter((file) => file.path === runtime.executable).length !== 1
    )
      throw new Error('Runtime manifest is missing its executable digest');
    for (const file of runtime.files) {
      resourcePath(root, file.path);
      if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid resource digest');
    }
  }
  resourcePath(root, manifest.webRoot);
  if (manifest.deploymentPolicy) {
    resourcePath(root, manifest.deploymentPolicy.path);
    if (!/^[a-f0-9]{64}$/.test(manifest.deploymentPolicy.sha256))
      throw new Error('Invalid resource digest');
  }
  return manifest;
}
/** Verify shipped executable bytes; this detects damaged staging, not a substitute
 * for platform signing. Verify all manifest files in the packaging smoke check. */
export async function verifyRuntimeFiles(
  root: string,
  manifest: RuntimeManifest,
  allFiles = false,
) {
  const files = [
    { path: manifest.service.executable, sha256: manifest.service.sha256 },
    ...(manifest.deploymentPolicy ? [manifest.deploymentPolicy] : []),
    ...Object.values(manifest.runtimes).flatMap((runtime) =>
      allFiles ? runtime.files : runtime.files.filter((file) => file.path === runtime.executable),
    ),
  ];
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid resource digest');
    const bytes = await readFile(resourcePath(root, file.path));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error(`Packaged resource integrity mismatch: ${file.path}`);
  }
}
