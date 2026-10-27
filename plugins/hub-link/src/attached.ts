import { ApplicationError } from '@agent-native/contracts';
import type { Link } from './network';

/** A page of the hub's own web build, opened with a one-use launch key. */
export interface HubLaunch {
  readonly origin: string;
  readonly url: string;
}

/**
 * Ask the hub for a one-use launch key with the device credential and build the page address.
 * The key is sent in the fragment, so it never reaches a server log; the hub page exchanges it for
 * a session cookie of its own, and the credential itself never enters the web view. Throws
 * UNAVAILABLE when the hub cannot be reached and FORBIDDEN when it refuses the credential.
 */
export async function requestLaunch(fetchImpl: typeof fetch, link: Link): Promise<HubLaunch> {
  const response = await fetchImpl(new URL('/api/v1/launch', link.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${link.token}`, 'Content-Type': 'application/json' },
    body: '{}',
    redirect: 'error',
  }).catch(() => {
    throw new ApplicationError('UNAVAILABLE', `The hub at ${link.origin} could not be reached`);
  });
  const body = (await response.json().catch(() => ({}))) as {
    launch?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.launch)
    throw new ApplicationError(
      response.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE',
      body.error?.message ?? `The hub refused to open its screens (${response.status})`,
    );
  return { origin: link.origin, url: `${link.origin}/#launch=${body.launch}` };
}

/**
 * Whether the web view may load a URL: only the hub's own origin, in any frame. Everything else is
 * refused, not handed to the system browser, so a hub page cannot send the person elsewhere.
 */
export function hubPageAllows(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
