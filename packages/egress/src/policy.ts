import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  canonicalJson,
  type CatalogRequirements,
  type NetworkDestination,
  type NetworkProtocol,
} from '@agent-native/contracts';
import { cidrIsPrivate, isLoopbackHost, parseCidr, type Cidr } from './cidr';

/**
 * Site policy: deployment data that binds declared destinations to real addresses and selects a
 * hardening profile. Code declares what it may need; only this file opens anything. Without a
 * policy the deployment is isolated (loopback only), which is the offline-first default.
 */
export const hardeningProfiles = ['desktop-local', 'sandbox', 'zero-trust'] as const;
export type HardeningProfile = (typeof hardeningProfiles)[number];

const pin = z
  .string()
  .regex(
    /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    'SHA-256 certificate fingerprint, colon-separated hex',
  );
const bindingSchema = z.union([
  z.strictObject({ disabled: z.literal(true), reason: z.string().max(500).optional() }),
  z.strictObject({
    /** Base URL (`https://mes.plant.local:8443/api`) or `tcp://host:port` for sockets. */
    url: z.string().min(1),
    /** Networks the host may resolve to. Required for firewall export and rebinding checks. */
    addresses: z.array(z.string()).optional(),
    /** PEM bundle path, relative to the policy file, replacing the default CA list. */
    ca: z.string().optional(),
    /** SHA-256 fingerprints of acceptable server certificates. */
    certificatePins: z.array(pin).optional(),
    /** Wrap a `tcp` destination in TLS. */
    tls: z.boolean().optional(),
  }),
]);
export const sitePolicySchema = z.strictObject({
  profile: z.enum(hardeningProfiles).default('desktop-local'),
  mode: z.enum(['isolated', 'connected']).default('isolated'),
  destinations: z.record(z.string(), bindingSchema).default({}),
  audit: z
    .strictObject({
      mode: z.enum(['fail-closed', 'best-effort']).default('fail-closed'),
      /** A bound destination that receives forwarded events (RFC 5424 over TLS). */
      forwardTo: z.string().optional(),
    })
    .default({ mode: 'fail-closed' }),
  identity: z.enum(['local-owner', 'grant-file', 'external']).default('local-owner'),
  ingress: z
    .strictObject({
      listen: z.enum(['loopback', 'unix', 'mtls']).default('loopback'),
      host: z.string().optional(),
      port: z.number().int().min(0).max(65535).optional(),
      cert: z.string().optional(),
      key: z.string().optional(),
      clientCa: z.string().optional(),
    })
    .default({ listen: 'loopback' }),
  grants: z.strictObject({ maxTtlSeconds: z.number().int().positive().optional() }).default({}),
});
export type SitePolicy = z.output<typeof sitePolicySchema>;
export type SitePolicyInput = z.input<typeof sitePolicySchema>;

export interface PolicyFinding {
  readonly level: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly destination?: string;
}
export type Declared = NetworkDestination & { readonly owner: string };
export interface ResolvedBinding {
  readonly destination: Declared;
  readonly url: URL;
  readonly addresses?: readonly Cidr[];
  /** PEM contents, loaded by `loadSitePolicy`. */
  readonly ca?: string;
  readonly caPath?: string;
  readonly certificatePins?: readonly string[];
  readonly tls?: boolean;
}
/** What does not work in this deployment and why: the offline-first consequence list. */
export interface OfflineConsequence {
  readonly destination: string;
  readonly owner: string;
  readonly availability: NetworkDestination['availability'];
  readonly offline: NonNullable<NetworkDestination['offline']>;
  readonly targets: readonly string[];
  readonly reason: 'isolated' | 'disabled' | 'unbound';
}
export interface ResolvedPolicy {
  readonly policy: SitePolicy;
  readonly profile: HardeningProfile;
  readonly mode: SitePolicy['mode'];
  readonly bindings: ReadonlyMap<string, ResolvedBinding>;
  readonly disabled: ReadonlySet<string>;
  readonly declared: ReadonlyMap<string, Declared>;
  readonly findings: readonly PolicyFinding[];
  readonly consequences: readonly OfflineConsequence[];
  /** SHA-256 of the canonical policy, for attestation events and reports. */
  readonly digest: string;
}

const schemes: Record<NetworkProtocol, string> = {
  https: 'https:',
  http: 'http:',
  wss: 'wss:',
  ws: 'ws:',
  tcp: 'tcp:',
  udp: 'udp:',
};
const defaultPorts: Partial<Record<string, number>> = {
  'https:': 443,
  'http:': 80,
  'wss:': 443,
  'ws:': 80,
};
export const portOf = (url: URL) => (url.port ? Number(url.port) : defaultPorts[url.protocol]);
/** Judged on the URL actually bound, so a mismatched declaration cannot mask plain text. */
const encrypted = (url: URL, binding: { tls?: boolean }) =>
  url.protocol === 'https:' ||
  url.protocol === 'wss:' ||
  (url.protocol === 'tcp:' && binding.tls === true);
const plaintextApplication = (url: URL) => url.protocol === 'http:' || url.protocol === 'ws:';

/**
 * Validate a site policy against the declared requirements and the profile's floor. Never
 * throws for policy content: problems are findings, and `assertPolicyUsable` refuses to start
 * when any finding is an error. Throws only when the JSON does not match the schema.
 */
export function resolveSitePolicy(
  input: unknown,
  requirements: CatalogRequirements,
  files: { readonly ca?: Readonly<Record<string, string>> } = {},
): ResolvedPolicy {
  const policy = sitePolicySchema.parse(input ?? {});
  const findings: PolicyFinding[] = [];
  const error = (code: string, message: string, destination?: string) =>
    findings.push({ level: 'error', code, message, ...(destination ? { destination } : {}) });
  const warn = (code: string, message: string, destination?: string) =>
    findings.push({ level: 'warning', code, message, ...(destination ? { destination } : {}) });
  const declared = new Map(requirements.network.map((item) => [item.id, item]));
  const bindings = new Map<string, ResolvedBinding>();
  const disabled = new Set<string>();
  const strict = policy.profile !== 'desktop-local';
  const zeroTrust = policy.profile === 'zero-trust';

  for (const [id, binding] of Object.entries(policy.destinations)) {
    const destination = declared.get(id);
    if (!destination) {
      error('UNDECLARED_BINDING', `No module or host component declares destination ${id}`, id);
      continue;
    }
    if ('disabled' in binding) {
      disabled.add(id);
      continue;
    }
    if (destination.direction !== 'egress') {
      error('INGRESS_BINDING', `Destination ${id} is ingress; bind listeners under ingress`, id);
      continue;
    }
    let url: URL;
    try {
      url = new URL(binding.url);
    } catch {
      error('INVALID_URL', `Destination ${id} has an invalid URL`, id);
      continue;
    }
    if (url.username || url.password) {
      error('CREDENTIALS_IN_URL', `Destination ${id} embeds credentials in its URL`, id);
      continue;
    }
    if (url.protocol !== schemes[destination.protocol])
      error('PROTOCOL_MISMATCH', `Destination ${id} is declared ${destination.protocol}`, id);
    if (destination.host && url.hostname !== destination.host)
      error('HOST_MISMATCH', `Destination ${id} is declared for host ${destination.host}`, id);
    const port = portOf(url);
    if (destination.port && port !== destination.port)
      error('PORT_MISMATCH', `Destination ${id} is declared for port ${destination.port}`, id);
    if (port === undefined) error('PORT_REQUIRED', `Destination ${id} needs an explicit port`, id);
    const loopback = isLoopbackHost(url.hostname);
    if (destination.scope === 'loopback' && !loopback)
      error('SCOPE_MISMATCH', `Loopback destination ${id} is bound to ${url.hostname}`, id);
    if (policy.mode === 'isolated' && !loopback)
      error('ISOLATED_BINDING', `Isolated mode cannot bind ${id} to a non-loopback host`, id);
    let addresses: Cidr[] | undefined;
    try {
      addresses = binding.addresses?.map(parseCidr);
    } catch (cause) {
      error('INVALID_ADDRESS', `Destination ${id}: ${(cause as Error).message}`, id);
    }
    if (!loopback && !addresses?.length)
      warn(
        'HOSTNAME_ONLY',
        `Destination ${id} has no addresses: DNS answers are not checked and firewall export cannot include it`,
        id,
      );
    if (destination.scope === 'site' && addresses?.some((network) => !cidrIsPrivate(network)))
      warn('PUBLIC_SITE_ADDRESS', `Site destination ${id} allows public addresses`, id);
    // Profile floors. Plain-text protocols leave the host only on desktop-local.
    if (strict && !loopback && plaintextApplication(url))
      error(
        'PLAINTEXT_EGRESS',
        `${policy.profile} forbids unencrypted ${url.protocol.slice(0, -1)} to ${id}`,
        id,
      );
    if (zeroTrust && !loopback && !plaintextApplication(url) && !encrypted(url, binding))
      error('PLAINTEXT_EGRESS', `zero-trust requires TLS to ${id}`, id);
    if (zeroTrust && !loopback && !binding.ca && !binding.certificatePins?.length)
      error('UNPINNED_TLS', `zero-trust requires a CA bundle or certificate pins for ${id}`, id);
    if (binding.ca && files.ca && files.ca[binding.ca] === undefined)
      error('CA_UNREADABLE', `CA bundle ${binding.ca} for ${id} could not be read`, id);
    bindings.set(id, {
      destination,
      url,
      ...(addresses ? { addresses } : {}),
      ...(binding.ca ? { caPath: binding.ca, ca: files.ca?.[binding.ca] } : {}),
      ...(binding.certificatePins ? { certificatePins: binding.certificatePins } : {}),
      ...(binding.tls ? { tls: true } : {}),
    } as ResolvedBinding);
  }

  const consequences: OfflineConsequence[] = [];
  for (const destination of requirements.network) {
    if (destination.direction !== 'egress' || bindings.has(destination.id)) continue;
    const reason = disabled.has(destination.id)
      ? 'disabled'
      : policy.mode === 'isolated'
        ? 'isolated'
        : 'unbound';
    consequences.push({
      destination: destination.id,
      owner: destination.owner,
      availability: destination.availability,
      offline: destination.offline ?? 'unavailable',
      targets: destination.targets ?? [],
      reason,
    });
    // A connected deployment must decide about every required destination explicitly.
    if (reason === 'unbound' && destination.availability === 'required')
      error(
        'REQUIRED_UNBOUND',
        `Required destination ${destination.id} is neither bound nor disabled`,
        destination.id,
      );
  }

  // Audit, identity, ingress and grant floors.
  if (strict && policy.audit.mode !== 'fail-closed')
    error('AUDIT_NOT_REQUIRED', `${policy.profile} requires a fail-closed event log`);
  if (policy.audit.forwardTo && !bindings.has(policy.audit.forwardTo))
    error('FORWARD_UNBOUND', `Audit forward destination ${policy.audit.forwardTo} is not bound`);
  if (zeroTrust && !policy.audit.forwardTo)
    error('AUDIT_NOT_FORWARDED', 'zero-trust requires forwarding audit events off the host');
  if (policy.profile === 'sandbox' && policy.identity === 'local-owner')
    error('IDENTITY_FLOOR', 'sandbox requires launcher grants or an external identity adapter');
  if (zeroTrust && policy.identity !== 'external')
    error('IDENTITY_FLOOR', 'zero-trust requires an external identity adapter');
  if (policy.ingress.listen === 'mtls' && !zeroTrust && policy.profile !== 'sandbox')
    warn('INGRESS_MTLS', 'mTLS ingress is intended for sandbox or zero-trust deployments');
  if (policy.profile === 'desktop-local' && policy.ingress.listen !== 'loopback')
    error('INGRESS_FLOOR', 'desktop-local listens on loopback only');
  if (policy.profile === 'sandbox' && policy.ingress.listen === 'mtls' && !policy.ingress.clientCa)
    error('INGRESS_FLOOR', 'mTLS ingress requires a client CA');
  if (
    policy.ingress.listen === 'mtls' &&
    (!policy.ingress.cert || !policy.ingress.key || !policy.ingress.clientCa)
  )
    error('INGRESS_FLOOR', 'mTLS ingress requires cert, key and clientCa');
  if (strict && policy.grants.maxTtlSeconds === undefined)
    error('GRANT_FLOOR', `${policy.profile} requires grants.maxTtlSeconds`);
  if (zeroTrust && (policy.grants.maxTtlSeconds ?? Infinity) > 3600)
    error('GRANT_FLOOR', 'zero-trust limits delegated grants to one hour');

  return {
    policy,
    profile: policy.profile,
    mode: policy.mode,
    bindings,
    disabled,
    declared,
    findings,
    consequences,
    digest: createHash('sha256')
      .update(canonicalJson(JSON.parse(JSON.stringify(policy))))
      .digest('hex'),
  };
}

/** Refuse to start on any error finding. The message lists every error at once. */
export function assertPolicyUsable(resolved: ResolvedPolicy): void {
  const errors = resolved.findings.filter((finding) => finding.level === 'error');
  if (errors.length)
    throw new Error(
      `Site policy rejected (${resolved.profile}):\n${errors.map((e) => `- ${e.code}: ${e.message}`).join('\n')}`,
    );
}

/** Read a policy file and the CA bundles it references (paths relative to the file). */
export async function loadSitePolicy(
  path: string,
  requirements: CatalogRequirements,
): Promise<ResolvedPolicy> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const parsed = sitePolicySchema.safeParse(raw);
  const ca: Record<string, string> = {};
  if (parsed.success)
    for (const binding of Object.values(parsed.data.destinations))
      if ('ca' in binding && binding.ca)
        ca[binding.ca] = await readFile(resolve(dirname(path), binding.ca), 'utf8').catch(
          () => undefined as unknown as string,
        );
  for (const [key, value] of Object.entries(ca)) if (value === undefined) delete ca[key];
  return resolveSitePolicy(raw, requirements, { ca });
}

/** The isolated default: loopback only, every egress destination reported as a consequence. */
export const isolatedPolicy = (
  requirements: CatalogRequirements,
  profile: HardeningProfile = 'desktop-local',
) => resolveSitePolicy({ profile, mode: 'isolated' }, requirements);
