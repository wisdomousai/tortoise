import type { ExportOptions } from '../exporters';
import type { RuleSet } from '../rules';
import { defaults, header, serviceArgs } from './common';

/** A hardened systemd unit that allows only loopback, resolvers and rule addresses. */
export function systemd(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  const allow = [
    'localhost',
    ...new Set([...rules.dns.resolvers, ...rules.allow.flatMap((rule) => rule.addresses)]),
  ];
  return [
    header(rules, 'systemd', '#'),
    '# IPAddressAllow restricts addresses, not ports; pair it with the nftables export for ports.',
    '[Unit]',
    `Description=${rules.application} local host`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${d.user}`,
    `Group=${d.user}`,
    `ExecStart=${[d.executable, ...serviceArgs(d)].join(' ')}`,
    'Restart=on-failure',
    'UMask=0077',
    'IPAddressDeny=any',
    ...allow.map((address) => `IPAddressAllow=${address}`),
    'NoNewPrivileges=yes',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'PrivateTmp=yes',
    '# Hides serial, HID and camera devices. For declared devices, remove it and add DeviceAllow=.',
    'PrivateDevices=yes',
    `ReadWritePaths=${d.workspace} ${d.auditLog}`,
    `ReadOnlyPaths=${d.deploymentPolicy}`,
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
    'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    'RestrictNamespaces=yes',
    'RestrictRealtime=yes',
    'RestrictSUIDSGID=yes',
    'LockPersonality=yes',
    'ProtectClock=yes',
    'ProtectHostname=yes',
    'ProtectKernelLogs=yes',
    'ProtectKernelModules=yes',
    'ProtectKernelTunables=yes',
    'ProtectControlGroups=yes',
    'ProtectProc=invisible',
    'ProcSubset=pid',
    'SystemCallArchitectures=native',
    'SystemCallFilter=@system-service',
    // @resources stays allowed: Bun raises its open-file limit at startup. A refused call
    // returns EPERM instead of killing the service, so a too-strict filter is visible in logs.
    'SystemCallFilter=~@privileged',
    'SystemCallErrorNumber=EPERM',
    '# MemoryDenyWriteExecute is not set: the JavaScript JIT needs writable executable memory.',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}
