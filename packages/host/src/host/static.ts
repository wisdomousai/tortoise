import { join } from 'node:path';

const staticHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/** One flat file of the built web client, under a strict content security policy. */
export async function serveStatic(webRoot: string | undefined, path: string) {
  if (!webRoot) return undefined;
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return undefined;
  const file = Bun.file(join(webRoot, name));
  if (!(await file.exists())) return undefined;
  return new Response(file, { headers: staticHeaders });
}

/**
 * The page an OS link lands on in a browser. A protocol handler navigates to `/?os=<link>` (and a
 * manifest shortcut to `/?os-shortcut=<id>`) from whichever site held the link, so this one
 * top-level document navigation is served although it is cross-site; every other cross-site
 * request stays refused. It returns only the static frame. The page then submits the link
 * same-origin as its own session, and an unsolicited request can only open or prefill.
 */
export async function serveOsLanding(webRoot: string | undefined, request: Request) {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (
    request.method !== 'GET' ||
    url.pathname !== '/' ||
    keys.length !== 1 ||
    !['os', 'os-shortcut'].includes(keys[0]!) ||
    request.headers.get('sec-fetch-mode') !== 'navigate' ||
    request.headers.get('sec-fetch-dest') !== 'document'
  )
    return undefined;
  return serveStatic(webRoot, '/');
}
