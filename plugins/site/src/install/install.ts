import {
  chmod,
  cp,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROW_SCHEMA_VERSION } from '@agent-native/adapters/row-storage';
import {
  admissionRefusals,
  verifyBundle,
  type BundleManifest,
  type SiteApproval,
  type TrustedKey,
} from '@agent-native/bundle';
import { ApplicationError } from '@agent-native/contracts';
import type { ApplicationManifest } from '@agent-native/host/manifest';
import { policyErrors, sitePolicyFor } from '../policy-file';
import {
  installLayout,
  type InstallLayout,
  type InstallRecord,
  type ServiceManager,
} from './layout';
import { loadCommands, nftTableOf, runCommand, stopCommands, unloadCommands } from './native';
import { windowsServiceXml } from './windows';

export interface InstallOptions {
  readonly bundle: string;
  readonly trusted: readonly TrustedKey[];
  readonly policy: string;
  readonly prefix: string;
  readonly service: ServiceManager;
  readonly user: string;
  readonly platform: string;
  readonly approval?: SiteApproval;
  /** Run the OS steps (service account, firewall, service). Without it only files are written. */
  readonly apply: boolean;
}

const refuse = (message: string) => new ApplicationError('CONFLICT', message);

async function readRecord(layout: InstallLayout): Promise<InstallRecord | undefined> {
  try {
    return JSON.parse(await readFile(layout.record, 'utf8')) as InstallRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The one executable a bundle carries under `bin/`. */
function binaryOf(bundle: BundleManifest): string {
  const binaries = bundle.files.filter((file) => file.path.startsWith('bin/'));
  if (binaries.length !== 1) throw refuse('A bundle must carry exactly one executable under bin/');
  return binaries[0]!.path;
}

/**
 * Copy a verified bundle to its release directory and verify the copy, so what runs is what was
 * signed. A release already there is verified and kept. Executables get mode 0755 and everything
 * else 0644, whatever modes the bundle arrived with.
 */
async function placeRelease(
  layout: InstallLayout,
  bundle: BundleManifest,
  options: InstallOptions,
) {
  const target = layout.release(bundle.version);
  try {
    await verifyBundle(target, options.trusted);
    return target;
  } catch {
    await rm(target, { recursive: true, force: true });
  }
  const staged = `${target}.partial`;
  await rm(staged, { recursive: true, force: true });
  await mkdir(layout.releases, { recursive: true, mode: 0o755 });
  await cp(options.bundle, staged, { recursive: true, verbatimSymlinks: true });
  for (const file of bundle.files)
    await chmod(join(staged, 'files', file.path), file.path.startsWith('bin/') ? 0o755 : 0o644);
  await verifyBundle(staged, options.trusted);
  await rename(staged, target);
  return target;
}

/** Service and firewall files, rendered by the release's own `network export`. */
async function renderService(
  layout: InstallLayout,
  options: InstallOptions,
  binary: string,
  serviceBinary: string,
) {
  const common = ['--site', layout.policy, '--user', options.user, '--executable', serviceBinary];
  const exportTo = (format: string, out: string, extra: string[] = []) => {
    runCommand([
      binary,
      'network',
      'export',
      '--format',
      format,
      ...common,
      ...extra,
      '--out',
      out,
    ]);
    return out;
  };
  if (options.service === 'systemd') {
    await mkdir(dirname(layout.unit), { recursive: true });
    const paths = ['--workspace', layout.workspace, '--audit-log', layout.audit];
    return [exportTo('systemd', layout.unit, paths), exportTo('nftables', layout.nftables)];
  }
  if (options.service === 'windows') {
    await writeFile(layout.windowsService, windowsServiceXml(layout, serviceBinary));
    return [exportTo('windows-firewall', layout.windowsFirewall), layout.windowsService];
  }
  return [];
}

/**
 * `site install`: verify the bundle against the trusted keys, admit it against the installed
 * release and the site approval, place the release, render the service and firewall files with
 * the release's own binary, migrate the workspace with it (staged, see `migrate`), then switch
 * `current` to it. A refusal or a failed migration leaves the previous release active and its
 * data untouched. With `apply`, the service is stopped before the migration and loaded after.
 */
export async function installBundle(
  manifest: ApplicationManifest,
  options: InstallOptions,
): Promise<InstallRecord> {
  const bundle = await verifyBundle(options.bundle, options.trusted);
  if (bundle.application !== manifest.id)
    throw refuse(`This binary installs ${manifest.id}, not ${bundle.application}`);
  const layout = installLayout(options.prefix, bundle.application);
  const record = await readRecord(layout);
  const installed = record
    ? await verifyBundle(layout.release(record.version), options.trusted)
    : undefined;
  const site = { platform: options.platform, storageSchemas: [ROW_SCHEMA_VERSION] };
  const refusals = admissionRefusals(bundle, site, installed, options.approval);
  if (refusals.length) throw refuse(refusals.join('; '));
  const policy = await sitePolicyFor(manifest, options.policy);
  const errors = policyErrors(policy);
  if (errors.length) throw new ApplicationError('INVALID_INPUT', errors[0]!.message);

  const release = await placeRelease(layout, bundle, options);
  await mkdir(layout.config, { recursive: true, mode: 0o755 });
  await mkdir(layout.workspace, { recursive: true, mode: 0o700 });
  await mkdir(layout.audit, { recursive: true, mode: 0o700 });
  await cp(options.policy, layout.policy);
  await chmod(layout.policy, 0o640);
  const binaryPath = join('files', binaryOf(bundle));
  const binary = join(release, binaryPath);
  const generated = await renderService(layout, options, binary, join(layout.current, binaryPath));
  const firewallTable =
    options.service === 'systemd' ? nftTableOf(await readFile(layout.nftables, 'utf8')) : undefined;

  if (options.apply)
    for (const command of stopCommands(layout, options.service)) runCommand(command);
  // The new release migrates the workspace before it becomes current; `migrate` refuses while
  // a host still owns the workspace.
  runCommand([binary, 'migrate', '--workspace', layout.workspace]);
  await rm(`${layout.current}.next`, { force: true });
  await symlink(release, `${layout.current}.next`);
  await rename(`${layout.current}.next`, layout.current);

  const next: InstallRecord = {
    application: bundle.application,
    version: bundle.version,
    platform: bundle.platform,
    service: options.service,
    user: options.user,
    policyDigest: policy.digest,
    installedAt: new Date().toISOString(),
    ...(record && record.version !== bundle.version ? { previous: record.version } : {}),
    ...(firewallTable ? { firewallTable } : {}),
    generated,
  };
  await writeFile(layout.record, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o640 });
  if (options.apply)
    for (const command of loadCommands(layout, options.service, options.user, firewallTable))
      runCommand(command);
  return next;
}

/**
 * `site status`: the install record, the release `current` points at, and whether that release
 * still verifies against the trusted keys (a changed file on disk shows here).
 */
export async function installStatus(
  manifest: ApplicationManifest,
  prefix: string,
  trusted: readonly TrustedKey[],
) {
  const layout = installLayout(prefix, manifest.id);
  const record = await readRecord(layout);
  if (!record) return { installed: false as const, application: manifest.id };
  const current = await readlink(layout.current).catch(() => undefined);
  let verified = true;
  let refusal: string | undefined;
  try {
    if (current !== layout.release(record.version))
      throw new Error('current is not the recorded release');
    await verifyBundle(current, trusted);
  } catch (error) {
    verified = false;
    refusal = (error as Error).message;
  }
  return {
    installed: true as const,
    ...record,
    current,
    verified,
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * `site uninstall`: with `apply`, stop and unregister the service and remove its firewall rules;
 * then remove the releases, `current`, the configuration and the record. The workspace and the
 * audit log stay unless `purge` is set, so uninstalling never deletes business records by default.
 */
export async function uninstall(
  manifest: ApplicationManifest,
  options: { readonly prefix: string; readonly apply: boolean; readonly purge: boolean },
) {
  const layout = installLayout(options.prefix, manifest.id);
  const record = await readRecord(layout);
  if (!record) return { removed: false, application: manifest.id };
  if (options.apply)
    for (const command of [
      ...stopCommands(layout, record.service),
      ...unloadCommands(layout, record.service, record.firewallTable),
    ])
      runCommand(command);
  for (const file of record.generated) await rm(file, { force: true });
  await rm(layout.current, { force: true });
  await rm(layout.releases, { recursive: true, force: true });
  await rm(layout.config, { recursive: true, force: true });
  await rm(layout.record, { force: true });
  if (options.purge) await rm(layout.data, { recursive: true, force: true });
  return { removed: true, application: manifest.id, purged: options.purge };
}
