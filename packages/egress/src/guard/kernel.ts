import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PeerCertificate } from 'node:tls';
import type {
  AuditRecord,
  AuditRequirement,
  EventLogPort,
  ProcessRequirement,
} from '@agent-native/contracts';
import { cidrContains, isLoopbackAddress, isLoopbackHost } from '../cidr';
import type { EgressOptions, HostLookup } from '../guard';
import { portOf, type ResolvedBinding, type ResolvedPolicy } from '../policy';
import { EgressDenied, type DenialReason } from './denial';

const defaultLookup: HostLookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/** Normalized origin for comparison; default ports are explicit. */
export const originOf = (url: URL) =>
  `${url.protocol}//${url.hostname.toLowerCase()}:${portOf(url)}`;

/** The guard's options with defaults applied, shared by every egress path. */
export interface GuardKernel {
  readonly policy: ResolvedPolicy;
  readonly eventLog?: EventLogPort;
  readonly lookup: HostLookup;
  readonly fetcher: typeof fetch;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly now: () => number;
  readonly processes: ReadonlyMap<string, ProcessRequirement>;
}

export function createGuardKernel(options: EgressOptions, fetcher: typeof fetch): GuardKernel {
  return {
    policy: options.policy,
    eventLog: options.eventLog,
    lookup: options.lookup ?? defaultLookup,
    fetcher,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxResponseBytes: options.maxResponseBytes ?? 32 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 5,
    now: options.now ?? Date.now,
    processes: new Map(options.requirements.processes.map((item) => [item.id, item])),
  };
}

/** Append audit records; with a required requirement, a failed append refuses the connection. */
export async function audit(
  kernel: GuardKernel,
  requirement: AuditRequirement,
  records: readonly AuditRecord[],
) {
  if (!kernel.eventLog) return;
  try {
    await kernel.eventLog.append(records);
  } catch {
    const destination = records[0]?.data?.destination;
    if (requirement === 'required')
      throw new EgressDenied(
        'AUDIT_UNAVAILABLE',
        typeof destination === 'string' ? destination : 'unknown',
      );
  }
}

/** Audit an allowed connection in the log's egress mode, before it opens. */
export const auditAllowed = (
  kernel: GuardKernel,
  destination: string,
  data: Record<string, string | number | boolean>,
) =>
  audit(kernel, kernel.eventLog?.mode.egress ?? 'best-effort', [
    event('egress.allowed', 'allowed', destination, data),
  ]);

export const event = (
  kind: string,
  outcome: AuditRecord['outcome'],
  destination: string,
  data: Record<string, string | number | boolean>,
  reason?: string,
): AuditRecord => ({
  kind,
  outcome,
  ...(reason ? { reason } : {}),
  data: { destination, ...data },
});

/** Record a denial (best effort) and throw it. */
export async function deny(
  kernel: GuardKernel,
  reason: DenialReason,
  destination: string,
  data: Record<string, string | number | boolean> = {},
): Promise<never> {
  await audit(kernel, 'best-effort', [event('egress.denied', 'denied', destination, data, reason)]);
  throw new EgressDenied(reason, destination);
}

/** The binding for a declared, bound egress destination, or a recorded denial. */
export async function bindingFor(
  kernel: GuardKernel,
  destinationId: string,
): Promise<ResolvedBinding> {
  const { policy } = kernel;
  const declared = policy.declared.get(destinationId);
  if (!declared) return deny(kernel, 'UNDECLARED', destinationId);
  if (declared.direction !== 'egress') return deny(kernel, 'NOT_EGRESS', destinationId);
  if (policy.disabled.has(destinationId)) return deny(kernel, 'DISABLED', destinationId);
  const binding = policy.bindings.get(destinationId);
  if (!binding) return deny(kernel, 'UNBOUND', destinationId);
  return binding;
}

/** Every address the host resolves to must be allowed; loopback scope must stay on loopback. */
export async function checkAddresses(kernel: GuardKernel, binding: ResolvedBinding, host: string) {
  const bare = host.replace(/^\[|\]$/g, '');
  const addresses = isIP(bare) ? [bare] : await kernel.lookup(bare).catch(() => [] as string[]);
  const id = binding.destination.id;
  if (!addresses.length)
    return deny(kernel, 'ADDRESS_NOT_ALLOWED', id, { host: bare, resolved: 0 });
  if (binding.destination.scope === 'loopback' || isLoopbackHost(binding.url.hostname)) {
    if (!addresses.every(isLoopbackAddress))
      return deny(kernel, 'ADDRESS_NOT_ALLOWED', id, { host: bare });
    return;
  }
  if (
    binding.addresses &&
    !addresses.every((address) =>
      binding.addresses!.some((network) => cidrContains(network, address)),
    )
  )
    return deny(kernel, 'ADDRESS_NOT_ALLOWED', id, { host: bare });
}

/** TLS settings from the binding: replacement CA bundle and certificate pins. */
export function tlsFor(binding: ResolvedBinding) {
  if (!binding.ca && !binding.certificatePins?.length) return undefined;
  return {
    ...(binding.ca ? { ca: binding.ca } : {}),
    ...(binding.certificatePins?.length
      ? {
          checkServerIdentity: (_host: string, certificate: PeerCertificate) =>
            binding.certificatePins!.includes(certificate.fingerprint256)
              ? undefined
              : new Error('Server certificate is not pinned'),
        }
      : {}),
  };
}
