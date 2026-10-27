import { createHash, randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** A person the stand-in provider can sign in. The email is the ID token's `email` and `sub`. */
export interface StandInPerson {
  readonly email: string;
  readonly name?: string;
}

export interface IdentityProviderOptions {
  /** The provider's issuer, an `https` origin. */
  readonly issuer: string;
  /** The one public client it serves, as the site policy's `workforce.clientId` names it. */
  readonly clientId: string;
  readonly people: readonly StandInPerson[];
  readonly now?: () => number;
}

const CODE_TTL = 5 * 60_000;
const MAX_CODES = 256;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const secret = () => randomBytes(32).toString('base64url');
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const refuse = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
const tokenError = (error: string) =>
  Response.json({ error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

/**
 * A stand-in OpenID Connect provider for tests and development launches, never for a deployment.
 * It serves discovery and its keys, shows a page that signs in one of `people`, and exchanges
 * the authorization code for an ES256 ID token after checking the PKCE (S256) verifier. It serves
 * one public client and redirects only to loopback, so it cannot sign anyone in to another host.
 * Its signing key and codes live in memory.
 */
export async function createIdentityProvider(options: IdentityProviderOptions) {
  const now = options.now ?? Date.now;
  const issuer = new URL(options.issuer);
  if (issuer.protocol !== 'https:' || issuer.pathname !== '/')
    throw new Error('The stand-in issuer must be an https origin');
  const origin = issuer.origin;
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'stand-in', alg: 'ES256', use: 'sig' };
  const people = new Map(options.people.map((person) => [person.email, person]));
  const codes = new Map<
    string,
    { email: string; redirectUri: string; challenge: string; nonce?: string; expires: number }
  >();

  /** The authorization request's parameters, or why they are refused. */
  function authorization(params: URLSearchParams) {
    const redirectUri = params.get('redirect_uri') ?? '';
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      return 'redirect_uri is not a URL';
    }
    if (!/^https?:$/.test(redirect.protocol) || !LOOPBACK.has(redirect.hostname))
      return 'The stand-in redirects to loopback only';
    if (params.get('client_id') !== options.clientId) return 'Unknown client_id';
    if (params.get('response_type') !== 'code') return 'response_type must be code';
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge'))
      return 'A PKCE S256 code_challenge is required';
    if (!params.get('state')) return 'state is required';
    return { redirect, redirectUri, challenge: params.get('code_challenge')! };
  }

  function page(params: URLSearchParams) {
    const hidden = [...params]
      .map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`)
      .join('');
    const buttons = [...people.values()]
      .map(
        (person) =>
          `<button name="person" value="${escape(person.email)}">${escape(person.name ?? person.email)}<small>${escape(person.email)}</small></button>`,
      )
      .join('');
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 16px}button{display:block;width:100%;margin:8px 0;padding:12px;font:inherit;text-align:left;cursor:pointer}small{display:block;opacity:.7}</style></head><body><h1>Sign in to ${escape(options.clientId)}</h1><p>Stand-in identity provider for development. Choose who signs in.</p><form method="post" action="/authorize">${hidden}${buttons}</form></body></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    );
  }

  async function signIn(form: URLSearchParams) {
    const request = authorization(form);
    if (typeof request === 'string') return refuse(400, request);
    const person = people.get(form.get('person') ?? '');
    if (!person) return refuse(400, 'Unknown person');
    for (const [key, value] of codes) if (value.expires <= now()) codes.delete(key);
    if (codes.size >= MAX_CODES) return refuse(503, 'Too many sign-ins in progress');
    const code = secret();
    codes.set(code, {
      email: person.email,
      redirectUri: request.redirectUri,
      challenge: request.challenge,
      ...(form.get('nonce') ? { nonce: form.get('nonce')! } : {}),
      expires: now() + CODE_TTL,
    });
    request.redirect.searchParams.set('code', code);
    request.redirect.searchParams.set('state', form.get('state')!);
    return new Response(null, {
      status: 302,
      headers: { Location: request.redirect.toString(), 'Cache-Control': 'no-store' },
    });
  }

  async function token(form: URLSearchParams) {
    const code = form.get('code') ?? '';
    const entry = codes.get(code);
    // One use: a replayed code finds nothing.
    codes.delete(code);
    if (form.get('grant_type') !== 'authorization_code')
      return tokenError('unsupported_grant_type');
    if (form.get('client_id') !== options.clientId) return tokenError('invalid_client');
    if (!entry || entry.expires <= now() || form.get('redirect_uri') !== entry.redirectUri)
      return tokenError('invalid_grant');
    const verifier = form.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier).digest('base64url') !== entry.challenge)
      return tokenError('invalid_grant');
    const person = people.get(entry.email)!;
    const seconds = Math.floor(now() / 1000);
    const idToken = await new SignJWT({
      email: person.email,
      email_verified: true,
      ...(person.name ? { name: person.name } : {}),
      ...(entry.nonce ? { nonce: entry.nonce } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
      .setIssuer(origin)
      .setAudience(options.clientId)
      .setSubject(person.email)
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + 300)
      .sign(privateKey);
    return Response.json(
      { id_token: idToken, access_token: secret(), token_type: 'Bearer', expires_in: 300 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /** Handle one request, as the listener does. A test can pass it as the destination's fetch. */
  async function respond(request: Request) {
    const url = new URL(request.url);
    if (url.origin !== origin) return refuse(404, 'Not this provider');
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /.well-known/openid-configuration')
      return Response.json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        jwks_uri: `${origin}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
        code_challenge_methods_supported: ['S256'],
      });
    if (route === 'GET /jwks') return Response.json({ keys: [jwk] });
    if (route === 'GET /authorize') {
      const request = authorization(url.searchParams);
      return typeof request === 'string' ? refuse(400, request) : page(url.searchParams);
    }
    if (route === 'POST /authorize') return signIn(new URLSearchParams(await request.text()));
    if (route === 'POST /token') return token(new URLSearchParams(await request.text()));
    return refuse(404, 'Not found');
  }

  return {
    issuer: origin,
    respond,
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      respond(input instanceof Request ? input : new Request(input, init)),
  };
}

export type IdentityProvider = Awaited<ReturnType<typeof createIdentityProvider>>;

/**
 * The stand-in provider on an HTTPS listener, at `https://<hostname>:<port>`. `tls` is the
 * certificate and key for that host name, such as one mkcert issues; the deployment policy binds
 * the `workforce-idp` destination with the matching `ca`. `port` defaults to a free one.
 */
export async function startIdentityProvider(
  options: Omit<IdentityProviderOptions, 'issuer'> & {
    readonly tls: { readonly cert: string; readonly key: string };
    readonly hostname?: string;
    readonly port?: number;
  },
) {
  const hostname = options.hostname ?? '127.0.0.1';
  let provider: IdentityProvider | undefined;
  const server = Bun.serve({
    hostname,
    port: options.port ?? 0,
    tls: options.tls,
    fetch: (request) => provider?.respond(request) ?? refuse(503, 'Starting'),
  });
  provider = await createIdentityProvider({
    ...options,
    issuer: `https://${hostname}:${server.port}`,
  });
  return { ...provider, stop: () => server.stop(true) };
}
