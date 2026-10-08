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
