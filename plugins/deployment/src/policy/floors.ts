import type { CatalogRequirements } from '@tortoise/contracts';
import type { OfflineConsequence, ResolvedBinding } from '../policy';
import type { Findings } from './findings';
import type { DeploymentPolicy } from './schema';

/** Every unbound outbound destination and why; a connected deployment must decide on required ones. */
export function offlineConsequences(
  policy: DeploymentPolicy,
  requirements: CatalogRequirements,
  bindings: ReadonlyMap<string, ResolvedBinding>,
  disabled: ReadonlySet<string>,
  { error }: Findings,
): OfflineConsequence[] {
  const consequences: OfflineConsequence[] = [];
  for (const destination of requirements.network) {
    if (destination.direction !== 'outbound' || bindings.has(destination.id)) continue;
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
  return consequences;
}

type IngressFiles = { readonly cert?: string; readonly key?: string; readonly clientCa?: string };

function checkIngress(
  policy: DeploymentPolicy,
  ingressFiles: IngressFiles | undefined,
  report: Findings,
) {
  const { error, warn } = report;
  const { listen, host, port, cert, key, clientCa } = policy.ingress;
  if (listen === 'mtls' && policy.profile === 'desktop-local')
    warn('INGRESS_MTLS', 'mTLS ingress is intended for hub, sandbox or zero-trust deployments');
  if (policy.profile === 'desktop-local' && listen !== 'loopback')
    error('INGRESS_FLOOR', 'desktop-local listens on loopback only');
  // Without client certificates, the network reaches the listener; zero-trust never allows that.
  if (policy.profile === 'zero-trust' && listen === 'tls')
    error('INGRESS_FLOOR', 'zero-trust admits network clients only over mutual TLS');
  if (listen === 'loopback') return;
  const name = listen === 'mtls' ? 'mTLS' : 'TLS';
  if (!cert || !key || (listen === 'mtls' && !clientCa))
    error(
      'INGRESS_FLOOR',
      `${name} ingress requires ${listen === 'mtls' ? 'cert, key and clientCa' : 'cert and key'}`,
    );
  if (listen === 'tls' && clientCa)
    error(
      'INGRESS_FLOOR',
      'clientCa applies to mtls only; a TLS listener does not check client certificates',
    );
  if (!host || !port)
    error('INGRESS_FLOOR', `${name} ingress requires the host name clients use and a fixed port`);
  // Files are checked only when the caller loaded them (`loadDeploymentPolicy`), as for CA bundles.
  if (
    ingressFiles &&
    (!ingressFiles.cert || !ingressFiles.key || (listen === 'mtls' && !ingressFiles.clientCa))
  )
    error('INGRESS_UNREADABLE', `${name} certificate, key or client CA could not be read`);
}

/** The destination the deployment plugin declares for the workforce identity provider. */
const WORKFORCE_DESTINATION = 'workforce-idp';

/** Audit, identity, ingress and grant floors of the selected profile. */
export function checkFloors(
  policy: DeploymentPolicy,
  bindings: ReadonlyMap<string, ResolvedBinding>,
  ingressFiles: IngressFiles | undefined,
  report: Findings,
) {
  const { error } = report;
  const strict = policy.profile !== 'desktop-local';
  const zeroTrust = policy.profile === 'zero-trust';
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
  const { workforce } = policy;
  if (policy.identity === 'external' && !workforce)
    error('IDENTITY_PROVIDER', 'external identity requires a workforce identity provider');
  if (workforce) {
    // Discovery, keys and the token exchange all go through the bound destination, so the issuer
    // the tokens name must be the origin that destination reaches.
    const issuer = new URL(workforce.issuer);
    const binding = bindings.get(WORKFORCE_DESTINATION);
    if (!binding)
      error('IDENTITY_PROVIDER', `The ${WORKFORCE_DESTINATION} destination is not bound`);
    else if (binding.url.origin !== issuer.origin)
      error('IDENTITY_PROVIDER', 'The workforce issuer must be on the origin of its destination');
    if (issuer.protocol !== 'https:')
      error('IDENTITY_PROVIDER', 'The workforce issuer must use https');
  }
  checkIngress(policy, ingressFiles, report);
  if (strict && policy.grants.maxTtlSeconds === undefined)
    error('GRANT_FLOOR', `${policy.profile} requires grants.maxTtlSeconds`);
  if (zeroTrust && (policy.grants.maxTtlSeconds ?? Infinity) > 3600)
    error('GRANT_FLOOR', 'zero-trust limits delegated grants to one hour');
}
