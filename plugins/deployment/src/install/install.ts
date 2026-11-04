import {
  chmod,
  cp,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROW_SCHEMA_VERSION } from '@tortoise/adapters/row-storage';
import {
  admissionRefusals,
  verifyBundle,
  type BundleManifest,
  type InstallApproval,
  type TrustedKey,
} from '@tortoise/bundle';
import { ApplicationError } from '@tortoise/contracts';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import { policyErrors, deploymentPolicyFor } from '../policy-file';
import { pastBestBefore } from '@tortoise/kernel/build';
import {
  binaryOf,
  installLayout,
  type InstallLayout,
  type InstallRecord,
  type ServiceManager,
} from './layout';
import { loadCommands, nftTableOf, runCommand, stopCommands, unloadCommands } from './native';
import { remainingEffects, undeliveredRefusal, type RemainingEffects } from './outbox';
import { windowsServiceXml } from './windows';

export interface InstallOptions {
  readonly bundle: string;
  readonly trusted: readonly TrustedKey[];
  readonly policy: string;
  readonly prefix: string;
  readonly service: ServiceManager;
  readonly user: string;
  readonly platform: string;
  readonly approval?: InstallApproval;
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

/**
 * Copy a verified bundle to its release directory and verify the copy, so what runs is what was
 * signed. A release already there is verified and kept. Executables get mode 0755 and everything
 * else 0644, whatever modes the bundle's files had.
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
  const common = ['--policy', layout.policy, '--user', options.user, '--executable', serviceBinary];
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
 * `app install`: verify the bundle against the trusted keys, admit it against the installed
 * release and the install approval, place the release, render the service and firewall files with
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
  const target = { platform: options.platform, storageSchemas: [ROW_SCHEMA_VERSION] };
  const refusals = admissionRefusals(bundle, target, installed, options.approval);
  if (refusals.length) throw refuse(refusals.join('; '));
  const policy = await deploymentPolicyFor(manifest, options.policy);
  const errors = policyErrors(policy);
  if (errors.length) throw new ApplicationError('INVALID_INPUT', errors[0]!.message);

  const release = await placeRelease(layout, bundle, options);
  await mkdir(layout.config, { recursive: true, mode: 0o755 });
  await mkdir(layout.workspace, { recursive: true, mode: 0o700 });
  await mkdir(layout.audit, { recursive: true, mode: 0o700 });
  await cp(options.policy, layout.policy);
  await chmod(layout.policy, 0o640);
  const binaryPath = binaryOf(bundle);
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
 * `app status`: the install record, the release `current` points at, and whether that release
 * still verifies against the trusted keys (a changed file on disk shows here). A verified release
 * that carries a best-before date reports it and whether it has passed; nothing is refused for it.
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
  let bundle: BundleManifest | undefined;
  let refusal: string | undefined;
  try {
    if (current !== layout.release(record.version))
      throw new Error('current is not the recorded release');
    bundle = await verifyBundle(current, trusted);
  } catch (error) {
    refusal = (error as Error).message;
  }
  return {
    installed: true as const,
    ...record,
    current,
    verified: bundle !== undefined,
    ...(refusal ? { refusal } : {}),
    ...(bundle?.bestBefore
      ? { bestBefore: bundle.bestBefore, pastBestBefore: pastBestBefore(bundle.bestBefore) }
      : {}),
  };
}

export interface UninstallOptions {
  readonly prefix: string;
  /** Stop and unregister the service and remove its firewall rules. */
  readonly apply: boolean;
  /** Delete the data directory too: the workspace, the audit log and the record. */
  readonly purge: boolean;
  /** Purge even when the outbox still holds effects; the result lists what was deleted. */
  readonly discardUndelivered?: boolean;
  /** Keys the installed release must verify against before a purge runs its `drain`. */
  readonly trusted?: readonly TrustedKey[];
}

/**
 * `app uninstall`: with `apply`, stop and unregister the service and remove its firewall rules;
 * then remove the releases, `current`, the configuration and the record. The workspace and the
 * audit log stay unless `purge` is set, so uninstalling never deletes business records by default.
 *
 * Before a purge, the installed release drains the outbox (see `remainingEffects`), after the
 * service is stopped and before anything is removed. Effects that are still pending, held or
 * awaiting the target's decision exist only in the workspace, so the purge is refused while any
 * remain, unless `discardUndelivered` is set. A refusal leaves every file in place; with `apply`
 * the service stays stopped.
 */
export async function uninstall(manifest: ApplicationManifest, options: UninstallOptions) {
  const layout = installLayout(options.prefix, manifest.id);
  const record = await readRecord(layout);
  if (!record) return { removed: false, application: manifest.id };
  if (options.discardUndelivered && !options.purge)
    throw new ApplicationError('INVALID_INPUT', '--discard-undelivered applies only with --purge');
  if (options.purge && !options.trusted)
    throw new ApplicationError(
      'INVALID_INPUT',
      '--trust is required with --purge, to verify the release that reads the outbox',
    );
  if (options.apply)
    for (const command of stopCommands(layout, record.service)) runCommand(command);
  let discarded: RemainingEffects[] = [];
  if (options.purge) {
    const remaining = await remainingEffects(manifest, layout, record, options.trusted!);
    if (remaining.length && !options.discardUndelivered) throw undeliveredRefusal(remaining);
    discarded = remaining;
  }
  if (options.apply)
    for (const command of unloadCommands(layout, record.service, record.firewallTable))
      runCommand(command);
  for (const file of record.generated) await rm(file, { force: true });
  await rm(layout.current, { force: true });
  await rm(layout.releases, { recursive: true, force: true });
  // Only when empty: a file someone else put there stays.
  await rmdir(dirname(layout.releases)).catch(() => undefined);
  await rm(layout.config, { recursive: true, force: true });
  await rm(layout.record, { force: true });
  if (options.purge) await rm(layout.data, { recursive: true, force: true });
  return {
    removed: true,
    application: manifest.id,
    purged: options.purge,
    ...(discarded.length ? { discarded } : {}),
  };
}
