import { isIP } from 'node:net';
import { portOf, type ResolvedPolicy } from '@tortoise/site/policy';

/** One allowed outbound flow, resolved to addresses an OS firewall can enforce. */
export interface AllowRule {
  readonly destination: string;
  readonly owner: string;
  readonly scope: 'site' | 'internet';
  readonly transport: 'tcp' | 'udp';
  readonly port: number;
  readonly host: string;
  /** CIDRs from the binding, or the literal address when the URL names one. */
  readonly addresses: readonly string[];
  readonly purpose: string;
  /** Declared child processes that may also tunnel here through the proxy. */
  readonly processes: readonly string[];
}
/** A bound destination no address-based rule can express; the export lists it as a gap. */
export interface UnresolvedRule {
  readonly destination: string;
  readonly host: string;
  readonly reason: 'HOSTNAME_ONLY' | 'PORT_UNKNOWN';
}

/**
 * The firewall-neutral rule set every exporter renders: default-deny outbound connections, loopback always
 * open, the bound destinations' addresses and ports, DNS only to named resolvers, and the
 * ingress listener. Deterministic for a given policy and options.
 */
export interface RuleSet {
  readonly format: 1;
  readonly application: string;
  readonly profile: ResolvedPolicy['profile'];
  readonly mode: ResolvedPolicy['mode'];
  readonly policyDigest: string;
  readonly defaultNetwork: 'deny';
  readonly ingress: ResolvedPolicy['policy']['ingress'];
  readonly allow: readonly AllowRule[];
  readonly dns: { readonly resolvers: readonly string[]; readonly needed: boolean };
  readonly unresolved: readonly UnresolvedRule[];
}

export interface RuleOptions {
  readonly application: string;
  /** DNS resolvers to allow on port 53. Needed when any bound URL names a host, not an IP. */
  readonly resolvers?: readonly string[];
  /** Composed process declarations, so each rule names the children that may use it. */
  readonly processes?: readonly { readonly id: string; readonly network?: readonly string[] }[];
}

const byDestination = <T extends { destination: string }>(a: T, b: T) =>
  a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0;

/**
 * Resolve a site policy into address rules. Loopback destinations need no rule; disabled and
 * unbound ones get none, which is what default-deny means. A hostname-only binding cannot be
 * enforced by address and is reported in `unresolved` instead of being silently widened.
 */
export function networkRules(policy: ResolvedPolicy, options: RuleOptions): RuleSet {
  const allow: AllowRule[] = [];
  const unresolved: UnresolvedRule[] = [];
  let needsDns = false;
  for (const [id, binding] of policy.bindings) {
    const declared = binding.destination;
    if (declared.direction !== 'outbound' || declared.scope === 'loopback') continue;
    const host = binding.url.hostname.replace(/^\[|\]$/g, '');
    const literal = isIP(host) !== 0;
    const port = portOf(binding.url) ?? (binding.url.port ? Number(binding.url.port) : undefined);
    if (port === undefined) {
      unresolved.push({ destination: id, host, reason: 'PORT_UNKNOWN' });
      continue;
    }
    const addresses = binding.addresses?.length
      ? binding.addresses.map((cidr) => cidr.text)
      : literal
        ? [host]
        : [];
    if (!addresses.length) {
      unresolved.push({ destination: id, host, reason: 'HOSTNAME_ONLY' });
      continue;
    }
    if (!literal) needsDns = true;
    allow.push({
      destination: id,
      owner: declared.owner,
      scope: declared.scope,
      transport: binding.url.protocol === 'udp:' ? 'udp' : 'tcp',
      port,
      host,
      addresses: [...addresses].sort(),
      purpose: declared.purpose,
      processes: (options.processes ?? [])
        .filter((process) => process.network?.includes(id))
        .map((process) => process.id)
        .sort(),
    });
  }
  return {
    format: 1,
    application: options.application,
    profile: policy.profile,
    mode: policy.mode,
    policyDigest: policy.digest,
    defaultNetwork: 'deny',
    ingress: policy.policy.ingress,
    allow: allow.sort(byDestination),
    dns: { resolvers: [...(options.resolvers ?? [])].sort(), needed: needsDns },
    unresolved: unresolved.sort(byDestination),
  };
}
