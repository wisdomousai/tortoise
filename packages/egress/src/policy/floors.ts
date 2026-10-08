import type { CatalogRequirements } from '@agent-native/contracts';
import type { OfflineConsequence, ResolvedBinding } from '../policy';
import type { Findings } from './findings';
import type { SitePolicy } from './schema';

/** Every unbound egress destination and why; a connected deployment must decide on required ones. */
export function offlineConsequences(
  policy: SitePolicy,
  requirements: CatalogRequirements,
  bindings: ReadonlyMap<string, ResolvedBinding>,
  disabled: ReadonlySet<string>,
  { error }: Findings,
): OfflineConsequence[] {
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
  return consequences;
}

type IngressFiles = { readonly cert?: string; readonly key?: string; readonly clientCa?: string };

function checkIngress(
  policy: SitePolicy,
  ingressFiles: IngressFiles | undefined,
  report: Findings,
) {
  const { error, warn } = report;
  const zeroTrust = policy.profile === 'zero-trust';
  if (policy.ingress.listen === 'mtls' && !zeroTrust && policy.profile !== 'sandbox')
    warn('INGRESS_MTLS', 'mTLS ingress is intended for sandbox or zero-trust deployments');
  if (policy.profile === 'desktop-local' && policy.ingress.listen !== 'loopback')
    error('INGRESS_FLOOR', 'desktop-local listens on loopback only');
  const mtls = policy.ingress.listen === 'mtls';
  if (mtls && (!policy.ingress.cert || !policy.ingress.key || !policy.ingress.clientCa))
    error('INGRESS_FLOOR', 'mTLS ingress requires cert, key and clientCa');
  if (mtls && (!policy.ingress.host || !policy.ingress.port))
    error('INGRESS_FLOOR', 'mTLS ingress requires the host name clients use and a fixed port');
  // Files are checked only when the caller loaded them (`loadSitePolicy`), as for CA bundles.
  if (mtls && ingressFiles && (!ingressFiles.cert || !ingressFiles.key || !ingressFiles.clientCa))
    error('INGRESS_UNREADABLE', 'mTLS certificate, key or client CA could not be read');
}

/** Audit, identity, ingress and grant floors of the selected profile. */
export function checkFloors(
  policy: SitePolicy,
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
  checkIngress(policy, ingressFiles, report);
  if (strict && policy.grants.maxTtlSeconds === undefined)
    error('GRANT_FLOOR', `${policy.profile} requires grants.maxTtlSeconds`);
  if (zeroTrust && (policy.grants.maxTtlSeconds ?? Infinity) > 3600)
    error('GRANT_FLOOR', 'zero-trust limits delegated grants to one hour');
}
