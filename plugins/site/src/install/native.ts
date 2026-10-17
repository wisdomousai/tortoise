import { ApplicationError } from '@agent-native/contracts';
import type { InstallLayout, ServiceManager } from './layout';

/**
 * Run one command to completion and return its standard output. A non-zero exit fails with the
 * command and its error output, which an operator reads to see what refused.
 */
export function runCommand(command: readonly string[]): string {
  const result = Bun.spawnSync([...command], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0)
    throw new ApplicationError(
      'UNAVAILABLE',
      `${command.join(' ')} exited with ${result.exitCode}: ${result.stderr.toString().trim()}`,
    );
  return result.stdout.toString();
}

/** The nftables table a rendered rule file declares; reloading or removing it replaces it whole. */
export const nftTableOf = (rules: string) => /^table inet ([a-z0-9_]+) \{$/m.exec(rules)?.[1];
const nftDelete = (table: string) => [
  'sh',
  '-c',
  `nft delete table inet ${table} 2>/dev/null || true`,
];
const wrapper = (layout: InstallLayout) => layout.windowsService.replace(/\.xml$/, '.exe');

/** The OS steps that load the installed files: service account, firewall, service. */
export function loadCommands(
  layout: InstallLayout,
  service: ServiceManager,
  user: string,
  table: string | undefined,
): string[][] {
  if (service === 'systemd')
    return [
      ['sh', '-c', `id -u ${user} >/dev/null 2>&1 || useradd --system --no-create-home ${user}`],
      ['chown', '-R', `${user}:${user}`, layout.data],
      // The export declares the table without flushing it; a reload replaces it whole.
      ...(table ? [nftDelete(table), ['nft', '-f', layout.nftables]] : []),
      ['systemctl', 'daemon-reload'],
      ['systemctl', 'enable', '--now', `${layout.service}.service`],
    ];
  if (service === 'windows')
    return [
      ['powershell', '-NoProfile', '-File', layout.windowsFirewall],
      // The service wrapper (WinSW) is supplied by the site; it reads the generated XML.
      [wrapper(layout), 'install'],
      [wrapper(layout), 'start'],
    ];
  return [];
}

/** Stop the service before its state is migrated or its files removed; a missing one is fine. */
export function stopCommands(layout: InstallLayout, service: ServiceManager): string[][] {
  if (service === 'systemd')
    return [['sh', '-c', `systemctl stop ${layout.service}.service || true`]];
  if (service === 'windows')
    return [
      [
        'powershell',
        '-NoProfile',
        '-Command',
        `Stop-Service ${layout.service} -ErrorAction SilentlyContinue`,
      ],
    ];
  return [];
}

/** Remove the service registration; firewall rules are removed with their files' group. */
export function unloadCommands(
  layout: InstallLayout,
  service: ServiceManager,
  table: string | undefined,
): string[][] {
  if (service === 'systemd')
    return [
      ['sh', '-c', `systemctl disable ${layout.service}.service || true`],
      ['systemctl', 'daemon-reload'],
      ...(table ? [nftDelete(table)] : []),
    ];
  if (service === 'windows')
    return [
      [wrapper(layout), 'uninstall'],
      [
        'powershell',
        '-NoProfile',
        '-Command',
        "Get-NetFirewallRule -Group 'agent-native egress (generated)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
      ],
    ];
  return [];
}
