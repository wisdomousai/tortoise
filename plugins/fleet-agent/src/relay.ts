import type { RelayResponse, RelayRequest } from './contracts';

/** Request headers passed to the site's API. Cookies, origin and forwarding headers never are. */
const requestHeaders = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'if-none-match',
  'last-event-id',
]);
/** Response headers passed back. `set-cookie` never is: a relayed caller gets no browser session. */
const responseHeaders = new Set([
  'cache-control',
  'content-type',
  'etag',
  'retry-after',
  'www-authenticate',
]);
const MAX_BODY = 1_048_576;

const pick = (headers: Iterable<[string, string]>, allowed: ReadonlySet<string>) =>
  Object.fromEntries([...headers].filter(([name]) => allowed.has(name.toLowerCase())));

/**
 * Forward one remote-access request to this host's own API and describe the response. The relay
 * adds no credential: a request reaches an operation only with a session the site itself issued,
 * which its own identity port and policy check like any other caller's. The fleet credential is
 * never attached, so whoever controls the fleet gains no access to the site through it.
 *
 * Trust boundary: `origin` is the host's own listener from `PluginStartContext.origin`, and the
 * path is confined to `/api/v1/` by the protocol schema, so the relay reaches nothing else.
 */
export async function forwardToSite(origin: string, request: RelayRequest): Promise<RelayResponse> {
  const url = new URL(request.path, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/v1/'))
    return { id: request.id, status: 400, headers: {} };
  const body = request.body ? Buffer.from(request.body, 'base64') : undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers: pick(Object.entries(request.headers), requestHeaders),
      redirect: 'manual',
      ...(body && request.method !== 'GET' ? { body } : {}),
    });
  } catch {
    return { id: request.id, status: 502, headers: {} };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BODY)
    return { id: request.id, status: 502, headers: { 'content-type': 'text/plain' } };
  return {
    id: request.id,
    status: response.status,
    headers: pick(response.headers.entries(), responseHeaders),
    ...(bytes.byteLength ? { body: Buffer.from(bytes).toString('base64') } : {}),
  };
}
