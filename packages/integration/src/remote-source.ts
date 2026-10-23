import { ApplicationError } from '@agent-native/contracts';
import type { RemoteSource } from '@agent-native/runtime';
import { DeliveryFailure, type SearchAccess, type SystemOfRecordPort } from './port.js';

/**
 * Where a remote source finds credentials for the target. Implementations read a credential
 * store (for example the OS vault); they never discover or reuse credentials implicitly, and
 * credentials never enter application state, query results or the audit log.
 */
export interface CallerCredentials<Credential = unknown> {
  /** The principal's own credential in the target, or `undefined` when none is connected. */
  forPrincipal(principalId: string, signal: AbortSignal): Promise<Credential | undefined>;
  /** A technical account, used only for capabilities that declare `caller-or-service` or `service`. */
  service?(signal: AbortSignal): Promise<Credential | undefined>;
}

export interface RemoteSourceOptions<Credential> {
  readonly target: string;
  readonly port: SystemOfRecordPort<unknown, Credential>;
  readonly credentials: CallerCredentials<Credential>;
}

/** Pick the credential: the caller's own first, then the service account where permitted. */
async function access<Credential>(
  options: RemoteSourceOptions<Credential>,
  principalId: string,
  identity: 'caller' | 'caller-or-service' | 'service',
  signal: AbortSignal,
): Promise<SearchAccess<Credential>> {
  if (identity !== 'service') {
    const own = await options.credentials.forPrincipal(principalId, signal);
    if (own !== undefined) return { credential: own, identity: 'caller' };
  }
  if (identity !== 'caller' && options.credentials.service) {
    const service = await options.credentials.service(signal);
    if (service !== undefined) return { credential: service, identity: 'service' };
  }
  if (identity === 'service')
    throw new ApplicationError('UNAVAILABLE', `${options.target} has no service credential`);
  throw new ApplicationError('FORBIDDEN', `Connect your ${options.target} account to search it`);
}

/**
 * Adapt a system-of-record port into the runtime's `RemoteSource` for one target.
 *
 * Identity: the credential belongs to the context's principal. A delegated agent's context
 * carries the delegating person's principal, so an agent searches with that person's access
 * and never more. A `service` credential is used only when the capability declares
 * `caller-or-service` or `service`, and `service` never asks for the caller's own; local policy
 * still projects the rows.
 *
 * Failures: `DeliveryFailure` text is caller-safe and becomes an `unavailable` status; any other
 * port error is reported generically by the runtime, so endpoints and tokens never leak.
 */
export function createRemoteSource<Credential>(
  options: RemoteSourceOptions<Credential>,
): RemoteSource {
  return {
    async search(request, call) {
      const search = options.port.search?.bind(options.port);
      if (!search)
        throw new ApplicationError('UNAVAILABLE', `${options.target} does not support search`);
      const granted = await access(options, call.context.principalId, call.identity, call.signal);
      try {
        const page = await search(request, granted, call.signal);
        return {
          items: page.items,
          ...(page.next ? { next: page.next } : {}),
          identity: granted.identity,
        };
      } catch (error) {
        if (error instanceof DeliveryFailure)
          throw new ApplicationError('UNAVAILABLE', error.message);
        throw error;
      }
    },
  };
}
