import type { ExportOptions } from '../exporters';
import type { RuleSet } from '../rules';
import { defaults, familyOf, header, identifier } from './common';

/** An nftables table that drops the service user's egress except loopback, DNS and the rules. */
export function nftables(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  const match = (address: string) => (familyOf(address) === 4 ? 'ip daddr' : 'ip6 daddr');
  const lines = [
    '#!/usr/sbin/nft -f',
    header(rules, 'nftables', '#'),
    `# Applies to sockets owned by user "${d.user}"; other users are unaffected.`,
    `table inet ${identifier(rules.application)} {`,
    '  chain output {',
    '    type filter hook output priority filter; policy accept;',
    `    meta skuid != "${d.user}" accept`,
    '    oif "lo" accept',
    '    ct state established,related accept',
  ];
  for (const resolver of rules.dns.resolvers)
    for (const transport of ['udp', 'tcp'])
      lines.push(`    ${match(resolver)} ${resolver} ${transport} dport 53 accept comment "dns"`);
  for (const rule of rules.allow) {
    lines.push(`    # ${rule.destination} (${rule.owner}, ${rule.scope}): ${rule.purpose}`);
    for (const address of rule.addresses)
      lines.push(
        `    ${match(address)} ${address} ${rule.transport} dport ${rule.port} accept comment "${rule.destination}"`,
      );
  }
  lines.push(
    `    counter log prefix "${d.name}-egress-deny " drop`,
    '  }',
    '}',
    ...(rules.ingress.listen === 'loopback'
      ? ['# Ingress: the authority listens on loopback only; no inbound rule is needed.']
      : [
          `# Ingress: ${rules.ingress.listen} listener on port ${rules.ingress.port ?? 'unset'}; open it in your host input policy to the clients that hold certificates.`,
        ]),
    '',
  );
  return lines.join('\n');
}
