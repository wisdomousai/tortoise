import { portOf } from '../policy';
import { destinationClient } from './client';
import { auditAllowed, checkAddresses, deny, originOf, type GuardKernel } from './kernel';

/** Check a CONNECT target against the destinations a declared child process may reach. */
export async function authorizeProcessTarget(
  kernel: GuardKernel,
  processId: string,
  host: string,
  port: number,
) {
  const declared = kernel.processes.get(processId);
  if (!declared)
    return deny(kernel, 'PROCESS_NOT_DECLARED', `process:${processId}`, { host, port });
  const wanted = host.toLowerCase().replace(/^\[|\]$/g, '');
  for (const destinationId of declared.network ?? []) {
    const binding = kernel.policy.bindings.get(destinationId);
    if (!binding) continue;
    if (
      binding.url.hostname.toLowerCase().replace(/^\[|\]$/g, '') === wanted &&
      portOf(binding.url) === port
    ) {
      await checkAddresses(kernel, binding, wanted);
      await auditAllowed(kernel, destinationId, { process: processId, tunnel: true });
      return destinationId;
    }
  }
  return deny(kernel, 'PROCESS_NOT_PERMITTED', `process:${processId}`, { host: wanted, port });
}

/** A `fetch` that routes each request to the listed destination bound to its origin. */
export function routedFetch(kernel: GuardKernel, destinationIds: readonly string[]): typeof fetch {
  const { policy } = kernel;
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
      return deny(kernel, 'ORIGIN_MISMATCH', destinationIds.join('|') || 'none', {
        origin: url.origin,
      });
    return destinationClient(kernel, destination).fetch(url, merged);
  };
  return routed as typeof fetch;
}
