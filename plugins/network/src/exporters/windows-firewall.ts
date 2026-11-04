import { parseCidr } from '@tortoise/site/cidr';
import type { ExportOptions } from '../exporters';
import type { RuleSet } from '../rules';
import { defaults, header } from './common';

// Windows evaluates block rules before allow rules, so "deny all but X" for one program is a
// block rule over the complement of X. Ranges are computed per address family.
const widths = { 4: 32n, 6: 128n } as const;
function formatAddress(value: bigint, family: 4 | 6): string {
  if (family === 4)
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n)
    groups.push(((value >> shift) & 0xffffn).toString(16));
  return groups.join(':');
}
function complement(networks: readonly string[], family: 4 | 6): string[] {
  const width = widths[family];
  const ranges = networks
    .map(parseCidr)
    .filter((cidr) => cidr.family === family)
    .map((cidr) => {
      const size = 1n << (width - BigInt(cidr.bits));
      return [cidr.base, cidr.base + size - 1n] as const;
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const result: string[] = [];
  let next = 0n;
  const max = (1n << width) - 1n;
  for (const [start, end] of ranges) {
    if (start > next)
      result.push(`${formatAddress(next, family)}-${formatAddress(start - 1n, family)}`);
    if (end + 1n > next) next = end + 1n;
  }
  if (next <= max) result.push(`${formatAddress(next, family)}-${formatAddress(max, family)}`);
  return result;
}
function portComplement(ports: readonly number[]): string[] {
  const result: string[] = [];
  let next = 1;
  for (const port of [...new Set(ports)].sort((a, b) => a - b)) {
    if (port > next) result.push(port - 1 === next ? `${next}` : `${next}-${port - 1}`);
    next = port + 1;
  }
  if (next <= 65535) result.push(next === 65535 ? '65535' : `${next}-65535`);
  return result;
}
const psList = (values: readonly string[]) =>
  `@(${values.map((value) => `'${value}'`).join(', ')})`;

export function windowsFirewall(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  const executable = options.executable ?? `C:\\Program Files\\${rules.application}\\service.exe`;
  const loopback = ['127.0.0.0/8', '::1/128'];
  const allowed = [
    ...new Set([...rules.allow.flatMap((rule) => rule.addresses), ...rules.dns.resolvers]),
  ];
  const lines = [
    header(rules, 'windows-firewall', '#'),
    '# Run in an elevated PowerShell. Every rule is scoped to the service executable.',
    "$ErrorActionPreference = 'Stop'",
    `$Program = '${executable.replace(/'/g, "''")}'`,
    `$Group = '${rules.application} egress (generated)'`,
    'Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule',
    '# Block every destination that no rule allows (loopback is never filtered by Windows Firewall).',
  ];
  for (const family of [4, 6] as const) {
    const ranges = complement([...loopback, ...allowed], family);
    if (ranges.length)
      lines.push(
        `New-NetFirewallRule -Group $Group -DisplayName '${d.name}: block other IPv${family}' -Direction Outbound -Action Block -Program $Program -Profile Any -RemoteAddress ${psList(ranges)} | Out-Null`,
      );
  }
  // On allowed addresses, block the protocols and ports no rule names.
  const byAddress = new Map<string, { tcp: number[]; udp: number[] }>();
  const add = (address: string, transport: 'tcp' | 'udp', port: number) => {
    const entry = byAddress.get(address) ?? { tcp: [], udp: [] };
    entry[transport].push(port);
    byAddress.set(address, entry);
  };
  for (const rule of rules.allow)
    for (const address of rule.addresses) add(address, rule.transport, rule.port);
  for (const resolver of rules.dns.resolvers) {
    add(resolver, 'udp', 53);
    add(resolver, 'tcp', 53);
  }
  for (const [address, ports] of [...byAddress].sort(([a], [b]) => (a < b ? -1 : 1)))
    for (const transport of ['tcp', 'udp'] as const) {
      const blocked = portComplement(ports[transport]);
      if (blocked.length)
        lines.push(
          `New-NetFirewallRule -Group $Group -DisplayName '${d.name}: block other ${transport.toUpperCase()} ports to ${address}' -Direction Outbound -Action Block -Program $Program -Profile Any -RemoteAddress '${address}' -Protocol ${transport.toUpperCase()} -RemotePort ${psList(blocked)} | Out-Null`,
        );
    }
  for (const rule of rules.allow)
    lines.push(
      `New-NetFirewallRule -Group $Group -DisplayName '${d.name}: ${rule.destination}' -Description '${rule.purpose.replace(/'/g, "''")}' -Direction Outbound -Action Allow -Program $Program -Profile Any -RemoteAddress ${psList(rule.addresses)} -Protocol ${rule.transport.toUpperCase()} -RemotePort ${rule.port} | Out-Null`,
    );
  lines.push(
    '# Protocols other than TCP and UDP to allowed addresses are not blocked by these rules.',
    '',
  );
  return lines.join('\n');
}
