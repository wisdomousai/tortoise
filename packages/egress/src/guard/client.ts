import type { DestinationClient } from '../guard';
import type { ResolvedBinding } from '../policy';
import { EgressDenied } from './denial';
import {
  audit,
  auditAllowed,
  bindingFor,
  checkAddresses,
  deny,
  event,
  originOf,
  tlsFor,
  type GuardKernel,
} from './kernel';

/** Cap the body; a larger response errors its stream instead of filling memory. */
function capped(response: Response, destination: string, maxResponseBytes: number): Response {
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

/** An absolute URL, or a relative path resolved against the bound origin. */
function targetUrl(input: string | URL, binding: ResolvedBinding) {
  return typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input)
    ? new URL(
        input.replace(/^\/+/, ''),
        binding.url.href.endsWith('/') ? binding.url : new URL(`${binding.url.href}/`),
      )
    : new URL(input);
}

/** The method and body for the next hop: 303, and 301/302 after POST, become a bodiless GET. */
function redirected(status: number, method: string, body: RequestInit['body']) {
  return status === 303 || ((status === 301 || status === 302) && method === 'POST')
    ? { method: 'GET', body: undefined }
    : { method, body };
}

async function guardedFetch(
  kernel: GuardKernel,
  destinationId: string,
  input: string | URL,
  init: RequestInit,
) {
  const binding = await bindingFor(kernel, destinationId);
  let url = targetUrl(input, binding);
  const tls = tlsFor(binding);
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(kernel.timeoutMs)])
    : AbortSignal.timeout(kernel.timeoutMs);
  let method = init.method ?? 'GET';
  let body = init.body;
  for (let hop = 0; ; hop++) {
    if (originOf(url) !== originOf(binding.url))
      return deny(kernel, hop ? 'REDIRECT_NOT_ALLOWED' : 'ORIGIN_MISMATCH', destinationId, {
        origin: url.origin,
      });
    await checkAddresses(kernel, binding, url.hostname);
    const started = kernel.now();
    // Logged before the connection opens: with a required log, no unrecorded egress.
    await auditAllowed(kernel, destinationId, { method, path: url.pathname, hop });
    const response = await kernel.fetcher(url, {
      ...init,
      method,
      ...(body === undefined ? {} : { body }),
      signal,
      redirect: 'manual',
      ...(tls ? { tls } : {}),
    } as RequestInit);
    await audit(kernel, 'best-effort', [
      event('egress.completed', 'completed', destinationId, {
        status: response.status,
        durationMs: kernel.now() - started,
        ...(response.headers.get('content-length')
          ? { contentLength: Number(response.headers.get('content-length')) }
          : {}),
      }),
    ]);
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location)
      return capped(response, destinationId, kernel.maxResponseBytes);
    if (hop >= kernel.maxRedirects) return deny(kernel, 'TOO_MANY_REDIRECTS', destinationId);
    // Follow only within the same destination, revalidating every hop.
    url = new URL(location, url);
    ({ method, body } = redirected(response.status, method, body));
  }
}

/** A client for one destination: its bound origin only, revalidated on every redirect hop. */
export function destinationClient(kernel: GuardKernel, destinationId: string): DestinationClient {
  return {
    destination: destinationId,
    fetch: (input, init = {}) => guardedFetch(kernel, destinationId, input, init),
  };
}
