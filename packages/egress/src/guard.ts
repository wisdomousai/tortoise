import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PeerCertificate } from 'node:tls';
import {
  ApplicationError,
  type AuditRecord,
  type AuditRequirement,
  type CatalogRequirements,
  type EventLogPort,
  type ProcessRequirement,
} from '@agent-native/contracts';
import { cidrContains, isLoopbackAddress, isLoopbackHost } from './cidr';
import { portOf, type ResolvedBinding, type ResolvedPolicy } from './policy';

/** Why a connection was refused. Codes are stable and safe to log and display. */
export type DenialReason =
  | 'UNDECLARED'
  | 'NOT_EGRESS'
  | 'DISABLED'
  | 'UNBOUND'
  | 'ORIGIN_MISMATCH'
  | 'ADDRESS_NOT_ALLOWED'
  | 'REDIRECT_NOT_ALLOWED'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'PROCESS_NOT_DECLARED'
  | 'PROCESS_NOT_PERMITTED'
  | 'AUDIT_UNAVAILABLE';
/**
 * A refused connection. It is an `UNAVAILABLE` application error so transports report it as a
 * missing dependency (HTTP 503, CLI exit 8), never as a server fault. The message carries only
 * the destination ID and reason code, which are declared, non-secret names.
 */
export class EgressDenied extends ApplicationError {
  constructor(
    readonly reason: DenialReason,
    readonly destination: string,
  ) {
    super('UNAVAILABLE', `Egress to ${destination} denied: ${reason}`, { destination, reason });
    this.name = 'EgressDenied';
  }
}

export type HostLookup = (host: string) => Promise<readonly string[]>;
const defaultLookup: HostLookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

export interface EgressOptions {
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

export interface Egress {
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

/** Normalized origin for comparison; default ports are explicit. */
const originOf = (url: URL) => `${url.protocol}//${url.hostname.toLowerCase()}:${portOf(url)}`;

/**
 * Deny-by-default outbound access. Only destinations that are both declared (by a module or host
 * component) and bound (by the site policy) are reachable, and only at their bound origin.
 * Every decision is audited; with a required egress log, a connection that cannot be logged is
 * not opened.
 *
 * Limits: the address check resolves the host and then connects by name, so a resolver that
 * answers differently between the two can race it. The OS rules exported from the same policy
 * (`security export`) close that gap. Child processes that ignore proxy settings are likewise
 * contained only by those rules.
 */
export function createEgress(options: EgressOptions): Egress {
  const { policy, eventLog } = options;
  const lookup = options.lookup ?? defaultLookup;
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 32 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const now = options.now ?? Date.now;
  const processes = new Map(options.requirements.processes.map((item) => [item.id, item]));

  async function audit(requirement: AuditRequirement, records: readonly AuditRecord[]) {
    if (!eventLog) return;
    try {
      await eventLog.append(records);
    } catch {
      const destination = records[0]?.data?.destination;
      if (requirement === 'required')
        throw new EgressDenied(
          'AUDIT_UNAVAILABLE',
          typeof destination === 'string' ? destination : 'unknown',
        );
    }
  }
  const event = (
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
  async function deny(
    reason: DenialReason,
    destination: string,
    data: Record<string, string | number | boolean> = {},
  ): Promise<never> {
    await audit('best-effort', [event('egress.denied', 'denied', destination, data, reason)]);
    throw new EgressDenied(reason, destination);
  }

  /** The binding for a declared, bound egress destination, or a recorded denial. */
  async function bindingFor(destinationId: string): Promise<ResolvedBinding> {
    const declared = policy.declared.get(destinationId);
    if (!declared) return deny('UNDECLARED', destinationId);
    if (declared.direction !== 'egress') return deny('NOT_EGRESS', destinationId);
    if (policy.disabled.has(destinationId)) return deny('DISABLED', destinationId);
    const binding = policy.bindings.get(destinationId);
    if (!binding) return deny('UNBOUND', destinationId);
    return binding;
  }

  /** Every address the host resolves to must be allowed; loopback scope must stay on loopback. */
  async function checkAddresses(binding: ResolvedBinding, host: string) {
    const bare = host.replace(/^\[|\]$/g, '');
    const addresses = isIP(bare) ? [bare] : await lookup(bare).catch(() => [] as string[]);
    const id = binding.destination.id;
    if (!addresses.length) return deny('ADDRESS_NOT_ALLOWED', id, { host: bare, resolved: 0 });
    if (binding.destination.scope === 'loopback' || isLoopbackHost(binding.url.hostname)) {
      if (!addresses.every(isLoopbackAddress))
        return deny('ADDRESS_NOT_ALLOWED', id, { host: bare });
      return;
    }
    if (
      binding.addresses &&
      !addresses.every((address) =>
        binding.addresses!.some((network) => cidrContains(network, address)),
      )
    )
      return deny('ADDRESS_NOT_ALLOWED', id, { host: bare });
  }

  /** TLS settings from the binding: replacement CA bundle and certificate pins. */
  function tlsFor(binding: ResolvedBinding) {
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

  /** Cap the body; a larger response errors its stream instead of filling memory. */
  function capped(response: Response, destination: string): Response {
    if (!response.body) return response;
    let total = 0;
    const limit = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxResponseBytes)
          controller.error(new EgressDenied('RESPONSE_TOO_LARGE', destination));
        else controller.enqueue(chunk);
      },
    });
    return new Response(response.body.pipeThrough(limit), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  function client(destinationId: string): DestinationClient {
    return {
      destination: destinationId,
      async fetch(input, init = {}) {
        const binding = await bindingFor(destinationId);
        let url =
          typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input)
            ? new URL(
                input.replace(/^\/+/, ''),
                binding.url.href.endsWith('/') ? binding.url : new URL(`${binding.url.href}/`),
              )
            : new URL(input);
        const tls = tlsFor(binding);
        const signal = init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
        let method = init.method ?? 'GET';
        let body = init.body;
        for (let hop = 0; ; hop++) {
          if (originOf(url) !== originOf(binding.url))
            return deny(hop ? 'REDIRECT_NOT_ALLOWED' : 'ORIGIN_MISMATCH', destinationId, {
              origin: url.origin,
            });
          await checkAddresses(binding, url.hostname);
          const started = now();
          // Logged before the connection opens: with a required log, no unrecorded egress.
          await audit(eventLog?.mode.egress ?? 'best-effort', [
            event('egress.allowed', 'allowed', destinationId, { method, path: url.pathname, hop }),
          ]);
          const response = await fetcher(url, {
            ...init,
            method,
            ...(body === undefined ? {} : { body }),
            signal,
            redirect: 'manual',
            ...(tls ? { tls } : {}),
          } as RequestInit);
          await audit('best-effort', [
            event('egress.completed', 'completed', destinationId, {
              status: response.status,
              durationMs: now() - started,
              ...(response.headers.get('content-length')
                ? { contentLength: Number(response.headers.get('content-length')) }
                : {}),
            }),
          ]);
          const location = response.headers.get('location');
          if (response.status < 300 || response.status >= 400 || !location)
            return capped(response, destinationId);
          if (hop >= maxRedirects) return deny('TOO_MANY_REDIRECTS', destinationId);
          // Follow only within the same destination, revalidating every hop.
          url = new URL(location, url);
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === 'POST')
          ) {
            method = 'GET';
            body = undefined;
          }
        }
      },
    };
  }

  async function socket<Data>(destinationId: string, handler: Bun.SocketHandler<Data>) {
    const binding = await bindingFor(destinationId);
    await checkAddresses(binding, binding.url.hostname);
    await audit(eventLog?.mode.egress ?? 'best-effort', [
      event('egress.allowed', 'allowed', destinationId, { socket: true }),
    ]);
    return Bun.connect<Data>({
      hostname: binding.url.hostname.replace(/^\[|\]$/g, ''),
      port: portOf(binding.url) ?? Number(binding.url.port),
      socket: handler,
      ...(binding.tls ? { tls: tlsFor(binding) ?? true } : {}),
    } as Bun.TCPSocketConnectOptions<Data>);
  }

  async function authorizeProcessTarget(processId: string, host: string, port: number) {
    const declared = processes.get(processId);
    if (!declared) return deny('PROCESS_NOT_DECLARED', `process:${processId}`, { host, port });
    const wanted = host.toLowerCase().replace(/^\[|\]$/g, '');
    for (const destinationId of declared.network ?? []) {
      const binding = policy.bindings.get(destinationId);
      if (!binding) continue;
      if (
        binding.url.hostname.toLowerCase().replace(/^\[|\]$/g, '') === wanted &&
        portOf(binding.url) === port
      ) {
        await checkAddresses(binding, wanted);
        await audit(eventLog?.mode.egress ?? 'best-effort', [
          event('egress.allowed', 'allowed', destinationId, { process: processId, tunnel: true }),
        ]);
        return destinationId;
      }
    }
    return deny('PROCESS_NOT_PERMITTED', `process:${processId}`, { host: wanted, port });
  }

  function routedFetch(destinationIds: readonly string[]): typeof fetch {
    const routed = async (input: string | URL | Request, init: RequestInit = {}) => {
      const request = input instanceof Request ? input : undefined;
      const url = new URL(request ? request.url : input.toString());
      const merged: RequestInit = request
        ? {
            method: request.method,
            headers: request.headers,
            ...(request.body ? { body: request.body } : {}),
            signal: request.signal,
            ...init,
          }
        : init;
      const host = url.hostname.toLowerCase();
      // A bound origin routes the request. Otherwise a listed destination declared for this
      // fixed host reports its own denial (DISABLED, UNBOUND) so callers can say why.
      const destination =
        destinationIds.find((id) => {
          const binding = policy.bindings.get(id);
          return binding && originOf(binding.url) === originOf(url);
        }) ??
        destinationIds.find(
          (id) => !policy.bindings.has(id) && policy.declared.get(id)?.host?.toLowerCase() === host,
        );
      if (!destination)
        return deny('ORIGIN_MISMATCH', destinationIds.join('|') || 'none', { origin: url.origin });
      return client(destination).fetch(url, merged);
    };
    return routed as typeof fetch;
  }

  return {
    client,
    routedFetch,
    socket,
    authorizeProcessTarget,
    process(processId) {
      const declared = processes.get(processId);
      if (!declared) throw new EgressDenied('PROCESS_NOT_DECLARED', `process:${processId}`);
      return declared;
    },
    audit,
  };
}
