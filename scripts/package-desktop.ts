import { build, Platform, Arch } from 'electron-builder';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { desktopTargets, type DesktopTarget } from '@agent-native/host/runtime-manifest';
import { readApplicationIdentity } from '@agent-native/host/config';

/** Packages an already staged immutable target. Provider/runtime acquisition and
 * compilation are separate so a packaging failure does not rebuild trusted assets. */
export async function packageDesktop(target: DesktopTarget, stageDirectory?: string) {
  if (!desktopTargets.includes(target)) throw new Error(`Unsupported desktop target: ${target}`);
  const stage = resolve(stageDirectory ?? resolve('artifacts/desktop', target));
  const identity = readApplicationIdentity(resolve(stage, 'app/app.config.json'));
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const os = JSON.parse(await readFile(resolve(stage, 'os-registrations.json'), 'utf8'));
  const platform = target.startsWith('darwin')
    ? Platform.MAC
    : target.startsWith('win32')
      ? Platform.WINDOWS
      : Platform.LINUX;
  return build({
    projectDir: resolve(stage, 'app'),
    targets: platform.createTarget('dir', target.endsWith('arm64') ? Arch.arm64 : Arch.x64),
    config: {
      appId: identity.appId,
      productName: identity.displayName,
      electronVersion: metadata.devDependencies.electron,
      asar: true,
      npmRebuild: false,
      directories: { output: resolve(stage, 'packaged') },
      files: ['main.mjs', 'preload.cjs', 'package.json', 'app.config.json'],
      extraResources: [{ from: resolve(stage, 'resources'), to: 'application' }],
      // The bundle's Info.plist carries the scheme and document types; macOS reads them from
      // there only. Windows registers the scheme at startup with `--` before the link (the
      // installer's registration has none), and the `dir` targets register no file types.
      mac: {
        category: 'public.app-category.productivity',
        identity: null,
        protocols: os.protocols,
        fileAssociations: os.fileAssociations,
      },
      linux: { category: 'Office' },
    },
  });
}
if (import.meta.main)
  await packageDesktop(
    (process.argv[2] ?? `${process.platform}-${process.arch}`) as DesktopTarget,
    process.argv[3],
  );
