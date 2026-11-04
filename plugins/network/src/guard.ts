import type {
  AuditRecord,
  AuditRequirement,
  CatalogRequirements,
  EventLogPort,
  ProcessRequirement,
} from '@tortoise/contracts';
import { portOf, type ResolvedPolicy } from '@tortoise/deployment/policy';
import { destinationClient } from './guard/client';
import { NetworkDenied } from './guard/denial';
import {
  audit,
  auditAllowed,
  bindingFor,
  checkAddresses,
  createGuardKernel,
  tlsFor,
  type GuardKernel,
} from './guard/kernel';
import { authorizeProcessTarget, routedFetch } from './guard/routing';

export { NetworkDenied, type DenialReason } from './guard/denial';

export type HostLookup = (host: string) => Promise<readonly string[]>;

export interface NetworkGuardOptions {
  readonly policy: ResolvedPolicy;
  readonly requirements: CatalogRequirements;
  readonly eventLog?: EventLogPort;
  /** Injected for tests; production resolves through the OS resolver. */
  readonly lookup?: HostLookup;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Per-request timeout. Default 30 s. */
  readonly timeoutMs?: number;
  /** Response body cap. Default 32 MiB. */
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
}

export interface DestinationClient {
  readonly destination: string;
  /** Like `fetch`, but only to this destination's bound origin. Relative paths resolve against it. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface NetworkGuard {
  client(destinationId: string): DestinationClient;
  /**
   * A drop-in `fetch` for SDKs that call several origins (an OAuth issuer and an API). Each
   * request goes to whichever listed destination is bound to its origin; anything else is denied.
   */
  routedFetch(destinationIds: readonly string[]): typeof fetch;
  /** Authorize and open a TCP socket to a bound `tcp` destination (VNC, RDP, vendor protocols). */
  socket<Data = undefined>(
    destinationId: string,
    handler: Bun.SocketHandler<Data>,
  ): Promise<Bun.Socket<Data>>;
  /**
   * Check a host and port against the destinations a declared child process may reach. Used by
   * the CONNECT proxy; returns the matching destination.
   */
  authorizeProcessTarget(processId: string, host: string, port: number): Promise<string>;
  process(processId: string): ProcessRequirement;
  audit(requirement: AuditRequirement, records: readonly AuditRecord[]): Promise<void>;
}

/** Authorize and open a TCP socket to a bound destination's host and port. */
async function socket<Data>(
  kernel: GuardKernel,
  destinationId: string,
  handler: Bun.SocketHandler<Data>,
) {
  const binding = await bindingFor(kernel, destinationId);
  await checkAddresses(kernel, binding, binding.url.hostname);
  await auditAllowed(kernel, destinationId, { socket: true });
  return Bun.connect<Data>({
    hostname: binding.url.hostname.replace(/^\[|\]$/g, ''),
    port: portOf(binding.url) ?? Number(binding.url.port),
    socket: handler,
    ...(binding.tls ? { tls: tlsFor(binding) ?? true } : {}),
  } as Bun.TCPSocketConnectOptions<Data>);
}

/**
 * Deny-by-default outbound access. Only destinations that are both declared (by a module or host
 * component) and bound (by the deployment policy) are reachable, and only at their bound origin.
 * Every decision is audited; with a required network log, a connection that cannot be logged is
 * not opened.
 *
 * Limits: the address check resolves the host and then connects by name, so a resolver that
 * returns different addresses between the two can race it. The OS rules exported from the same policy
 * (`network export`) close that gap. Child processes that ignore proxy settings are likewise
 * contained only by those rules.
 */
export function createNetworkGuard(options: NetworkGuardOptions): NetworkGuard {
  const kernel = createGuardKernel(options, options.fetch ?? fetch);
  return {
    client: (destinationId) => destinationClient(kernel, destinationId),
    routedFetch: (destinationIds) => routedFetch(kernel, destinationIds),
    socket: (destinationId, handler) => socket(kernel, destinationId, handler),
    authorizeProcessTarget: (processId, host, port) =>
      authorizeProcessTarget(kernel, processId, host, port),
    process(processId) {
      const declared = kernel.processes.get(processId);
      if (!declared) throw new NetworkDenied('PROCESS_NOT_DECLARED', `process:${processId}`);
      return declared;
    },
    audit: (requirement, records) => audit(kernel, requirement, records),
  };
}
