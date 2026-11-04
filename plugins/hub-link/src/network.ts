import { ApplicationError } from '@tortoise/contracts';
import type { NetworkPort } from '@tortoise/kernel/plugin';

/** The hub the device talks to right now, with its credential; undefined while unpaired. */
export interface Link {
  readonly origin: string;
  readonly token: string;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A hub origin the device may pair with: `https`, or `http` on loopback, which on a device only
 * reaches a port forwarded to the development machine (`adb reverse`), so the credential never
 * crosses a network in clear text. Returns the normalized origin; throws INVALID_INPUT otherwise.
 */
export function hubOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'Hub address is not a URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname)))
    throw new ApplicationError('INVALID_INPUT', 'The hub must be reached over https');
  return url.origin;
}

/**
 * The device's network port: one destination, `hub`, at the paired origin, with the device
 * credential on every request. Requests that leave the origin, including by redirect, are refused,
 * so the credential is sent only to the hub it was issued by. Every other destination is
 * unavailable on the device. While unpaired every call throws UNAVAILABLE.
 */
export function hubNetworkPort(
  current: () => Link | undefined,
  fetchImpl: typeof fetch,
): NetworkPort {
  const hubFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const link = current();
    if (!link) throw new ApplicationError('UNAVAILABLE', 'This device is not paired with a hub');
    const url = new URL(input instanceof Request ? input.url : input, link.origin);
    if (url.origin !== link.origin)
      throw new ApplicationError(
        'FORBIDDEN',
        `Only the paired hub is reachable, not ${url.origin}`,
      );
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set('Authorization', `Bearer ${link.token}`);
    return fetchImpl(url, { ...init, headers, redirect: 'error' });
  };
  const only = (destinationId: string) => {
    if (destinationId !== 'hub')
      throw new ApplicationError(
        'UNAVAILABLE',
        `Destination ${destinationId} is unreachable from this device`,
      );
  };
  return {
    client(destinationId) {
      only(destinationId);
      return { destination: destinationId, fetch: hubFetch };
    },
    routedFetch(destinationIds) {
      destinationIds.forEach(only);
      return hubFetch as typeof fetch;
    },
  };
}
