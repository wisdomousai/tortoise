import { cidrIsPrivate, isLoopbackHost, parseCidr, type Cidr } from '../cidr';
import type { Declared, ResolvedBinding } from '../policy';
import type { Findings } from './findings';
import type { SitePolicy } from './schema';
import { encrypted, plaintextApplication, plaintextOf, portOf, schemes } from './urls';

type Binding = Exclude<SitePolicy['destinations'][string], { disabled: true }>;
interface BindingScope {
  readonly policy: SitePolicy;
  readonly report: Findings;
  readonly ca?: Readonly<Record<string, string>>;
}

/** The bound URL, or undefined after reporting why it cannot be used at all. */
function boundUrl(id: string, binding: Binding, { error }: Findings): URL | undefined {
  let url: URL;
  try {
    url = new URL(binding.url);
  } catch {
    error('INVALID_URL', `Destination ${id} has an invalid URL`, id);
    return undefined;
  }
  if (url.username || url.password) {
    error('CREDENTIALS_IN_URL', `Destination ${id} embeds credentials in its URL`, id);
    return undefined;
  }
  return url;
}

/** The URL must match what the destination declares: protocol, host, port and scope. */
function checkDeclaration(id: string, destination: Declared, url: URL, scope: BindingScope) {
  const { error, warn } = scope.report;
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== schemes[destination.protocol]) {
    // A local server, such as a second instance on this machine, rarely has a certificate.
    if (loopback && plaintextOf[destination.protocol] === url.protocol)
      warn(
        'LOOPBACK_PLAINTEXT',
        `Destination ${id} is declared ${destination.protocol} and bound to plain text on loopback`,
        id,
      );
    else error('PROTOCOL_MISMATCH', `Destination ${id} is declared ${destination.protocol}`, id);
  }
  if (destination.host && url.hostname !== destination.host)
    error('HOST_MISMATCH', `Destination ${id} is declared for host ${destination.host}`, id);
  const port = portOf(url);
  if (destination.port && port !== destination.port)
    error('PORT_MISMATCH', `Destination ${id} is declared for port ${destination.port}`, id);
  if (port === undefined) error('PORT_REQUIRED', `Destination ${id} needs an explicit port`, id);
  if (destination.scope === 'loopback' && !loopback)
    error('SCOPE_MISMATCH', `Loopback destination ${id} is bound to ${url.hostname}`, id);
  if (scope.policy.mode === 'isolated' && !loopback)
    error('ISOLATED_BINDING', `Isolated mode cannot bind ${id} to a non-loopback host`, id);
  return loopback;
}

function boundAddresses(
  id: string,
  destination: Declared,
  binding: Binding,
  loopback: boolean,
  { error, warn }: Findings,
): Cidr[] | undefined {
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
  return addresses;
}

/** Profile floors. Plain-text protocols leave the host only on desktop-local. */
function checkTransport(
  id: string,
  destination: Declared,
  url: URL,
  binding: Binding,
  loopback: boolean,
  scope: BindingScope,
) {
  const { policy, report } = scope;
  // A credential sent in plain text off this machine can be read and replayed on the way.
  if (destination.authenticated && !loopback && !encrypted(url, binding))
    report.error('PLAINTEXT_CREDENTIAL', `${id} carries a credential and needs TLS`, id);
  const strict = policy.profile !== 'desktop-local';
  const zeroTrust = policy.profile === 'zero-trust';
  if (strict && !loopback && plaintextApplication(url))
    report.error(
      'PLAINTEXT_EGRESS',
      `${policy.profile} forbids unencrypted ${url.protocol.slice(0, -1)} to ${id}`,
      id,
    );
  if (zeroTrust && !loopback && !plaintextApplication(url) && !encrypted(url, binding))
    report.error('PLAINTEXT_EGRESS', `zero-trust requires TLS to ${id}`, id);
  if (zeroTrust && !loopback && !binding.ca && !binding.certificatePins?.length)
    report.error(
      'UNPINNED_TLS',
      `zero-trust requires a CA bundle or certificate pins for ${id}`,
      id,
    );
  if (binding.ca && scope.ca && scope.ca[binding.ca] === undefined)
    report.error('CA_UNREADABLE', `CA bundle ${binding.ca} for ${id} could not be read`, id);
}

/**
 * Resolve one enabled binding of a declared egress destination, reporting every problem.
 * Returns undefined only when the URL itself is unusable.
 */
export function resolveBinding(
  id: string,
  destination: Declared,
  binding: Binding,
  scope: BindingScope,
): ResolvedBinding | undefined {
  const url = boundUrl(id, binding, scope.report);
  if (!url) return undefined;
  const loopback = checkDeclaration(id, destination, url, scope);
  const addresses = boundAddresses(id, destination, binding, loopback, scope.report);
  checkTransport(id, destination, url, binding, loopback, scope);
  return {
    destination,
    url,
    ...(addresses ? { addresses } : {}),
    ...(binding.ca ? { caPath: binding.ca, ca: scope.ca?.[binding.ca] } : {}),
    ...(binding.certificatePins ? { certificatePins: binding.certificatePins } : {}),
    ...(binding.tls ? { tls: true } : {}),
    ...(binding.timeoutMs ? { timeoutMs: binding.timeoutMs } : {}),
    ...(binding.maxResponseBytes ? { maxResponseBytes: binding.maxResponseBytes } : {}),
  } as ResolvedBinding;
}
