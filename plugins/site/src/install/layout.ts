import { join } from 'node:path';
import type { BundleManifest } from '@tortoise/bundle';
import { ApplicationError } from '@tortoise/contracts';

/** How the installed service is started: a systemd unit, a Windows service wrapper, or neither. */
export type ServiceManager = 'systemd' | 'windows' | 'none';

/**
 * Where one application lives on a site host. Every path is under `prefix` (`/` for a real
 * install), so a staged or test install is the same tree in another directory:
 *
 * - `opt/agent-native/<app>/releases/<version>`: verified bundle payloads, one per version;
 * - `opt/agent-native/<app>/current`: a link to the active release, which the service starts;
 * - `etc/agent-native/<app>`: the site policy and the generated firewall rules;
 * - `var/lib/agent-native/<app>`: the workspace, the audit log and the install record. Data is
 *   never inside a release, so switching releases never moves it.
 */
export function installLayout(prefix: string, application: string) {
  const home = join(prefix, 'opt/agent-native', application);
  const config = join(prefix, 'etc/agent-native', application);
  const data = join(prefix, 'var/lib/agent-native', application);
  const service = `agent-native-${application}`;
  return {
    service,
    releases: join(home, 'releases'),
    release: (version: string) => join(home, 'releases', version),
    current: join(home, 'current'),
    config,
    policy: join(config, 'site-policy.json'),
    nftables: join(config, 'egress.nft'),
    windowsFirewall: join(config, 'egress-firewall.ps1'),
    windowsService: join(config, `${service}.xml`),
    unit: join(prefix, 'etc/systemd/system', `${service}.service`),
    data,
    workspace: join(data, 'workspace'),
    audit: join(data, 'audit'),
    record: join(data, 'install.json'),
  };
}
export type InstallLayout = ReturnType<typeof installLayout>;

/** What `app install` wrote, read back by `status`, the next install and `uninstall`. */
export interface InstallRecord {
  readonly application: string;
  readonly version: string;
  readonly platform: string;
  readonly service: ServiceManager;
  readonly user: string;
  readonly policyDigest: string;
  readonly installedAt: string;
  /** The version this install replaced, for an operator who wants to switch back. */
  readonly previous?: string;
  /** The nftables table the rendered rules declare, when the service manager is systemd. */
  readonly firewallTable?: string;
  /** Generated files outside the release and data directories. */
  readonly generated: readonly string[];
}

/** The one executable a bundle carries, as a path under the release directory. */
export function binaryOf(bundle: BundleManifest): string {
  const binaries = bundle.files.filter((file) => file.path.startsWith('bin/'));
  if (binaries.length !== 1)
    throw new ApplicationError('CONFLICT', 'A bundle must carry exactly one executable under bin/');
  return join('files', binaries[0]!.path);
}
