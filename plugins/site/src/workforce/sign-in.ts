import { createHash, randomBytes } from 'node:crypto';
import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  type JWTVerifyGetKey,
} from 'jose';
import { verifyOidcIdentity } from '@agent-native/agents/oidc';
import type { SitePolicy } from '@agent-native/egress';
import { LOCAL_WORKSPACE } from '@agent-native/kernel/authority';
import type { ExecutionContext } from '@agent-native/runtime';
import { discover, providerJson, type DestinationFetch, type ProviderMetadata } from './discovery';

export type WorkforceConfig = NonNullable<SitePolicy['workforce']>;

export interface WorkforceOptions {
  /**
   * The bound destination's fetch. A function, because the network port resolves only once every
   * plugin has opened.
   */
  readonly fetch: () => DestinationFetch;
  readonly now?: () => number;
  /** Key resolver for tests; otherwise the provider's JWKS, fetched through `fetch`. */
  readonly keys?: JWTVerifyGetKey;
}

const PENDING_TTL = 10 * 60_000;
const MAX_PENDING = 256;
const MAX_SESSIONS = 10_000;
const secret = () => randomBytes(32).toString('base64url');
const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });

/** Drop expired entries, then refuse when `map` is still at `limit`. */
function prune<T extends { expires: number }>(map: Map<string, T>, now: number, limit: number) {
  for (const [key, value] of map) if (value.expires <= now) map.delete(key);
  if (map.size >= limit) throw new Error('Too many sign-ins in progress');
}

/** The principal ID the configured claim names, from a verified ID token. */
function principalOf(config: WorkforceConfig, payload: Record<string, unknown>) {
  const value = payload[config.principalClaim];
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new Error(`The ID token has no usable ${config.principalClaim} claim`);
  if (config.principalClaim === 'email' && payload.email_verified === false)
    throw new Error('The identity provider has not verified this email address');
  return value;
}

/**
 * Workforce sign-in for `identity: external`: an OpenID Connect public client using the
 * authorization code flow with PKCE (S256), served as the site plugin's public routes.
 *
 * - `GET /auth/sign-in` redirects to the provider with a fresh state, nonce and code challenge,
 *   kept in memory for ten minutes.
 * - `GET /auth/callback` consumes the state once, exchanges the code, verifies the ID token
 *   (signature from the provider's keys, issuer, audience, nonce, expiry) and sets the
 *   `agent_session` cookie to a session token of its own, valid for `sessionMinutes`.
 * - `POST /auth/sign-out` ends that session; it checks the Origin itself, because public routes
 *   run before the host's origin check.
 *
 * Trust boundary: the redirect URI is the request's own origin, which the host has already
 * checked against its Host header. The provider is reached only through the bound destination.
 * Sessions live in memory, so a restart signs everyone out. The ID token is not kept.
 */
export function createWorkforceSignIn(config: WorkforceConfig, options: WorkforceOptions) {
  const now = options.now ?? Date.now;
  const pending = new Map<string, { verifier: string; nonce: string; expires: number }>();
  const sessions = new Map<string, { context: ExecutionContext; expires: number }>();
  let provider: Promise<{ metadata: ProviderMetadata; keys: JWTVerifyGetKey }> | undefined;
  const fetcher: DestinationFetch = (input, init) => options.fetch()(input, init);

  // Discovered once; a failed discovery is retried on the next sign-in.
  function connect() {
    provider ??= discover(config.issuer, fetcher).then((metadata) => ({
      metadata,
      keys:
        options.keys ??
        createRemoteJWKSet(new URL(metadata.jwksUri), {
          timeoutDuration: 5_000,
          [customFetch]: fetcher as unknown as FetchImplementation,
        }),
    }));
    provider.catch(() => (provider = undefined));
    return provider;
  }

  async function begin(origin: string) {
    const { metadata } = await connect();
    prune(pending, now(), MAX_PENDING);
    const state = secret();
    const nonce = secret();
    const verifier = secret();
    pending.set(state, { verifier, nonce, expires: now() + PENDING_TTL });
    const url = new URL(metadata.authorizationEndpoint);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: `${origin}/auth/callback`,
      scope: config.scopes.join(' '),
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }))
      url.searchParams.set(key, value);
    return Response.redirect(url.toString(), 302);
  }

  async function complete(url: URL) {
    const state = url.searchParams.get('state') ?? '';
    const entry = pending.get(state);
    // One use: a replayed or forged state finds nothing.
    pending.delete(state);
    if (!entry || entry.expires <= now())
      throw new Error('This sign-in expired or was already used');
    if (url.searchParams.has('error'))
      throw new Error('The identity provider declined the sign-in');
    const code = url.searchParams.get('code');
    if (!code || code.length > 8_192) throw new Error('The callback carries no authorization code');
    const { metadata, keys } = await connect();
    const tokens = await providerJson(
      await fetcher(metadata.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: entry.verifier,
          client_id: config.clientId,
          redirect_uri: `${url.origin}/auth/callback`,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      }),
    );
    if (typeof tokens.id_token !== 'string') throw new Error('The token response has no ID token');
    const payload = await verifyOidcIdentity(
      tokens.id_token,
      keys,
      config.issuer,
      config.clientId,
      entry.nonce,
      now(),
    );
    const principalId = principalOf(config, payload);
    prune(sessions, now(), MAX_SESSIONS);
    const token = secret();
    const maxAge = config.sessionMinutes * 60;
    sessions.set(token, {
      context: { workspaceId: LOCAL_WORKSPACE, principalId },
      expires: now() + maxAge * 1000,
    });
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
        'Set-Cookie': `agent_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
      },
    });
  }

  function signOut(request: Request, url: URL) {
    if (request.headers.get('origin') !== url.origin) return text(403, 'Untrusted origin');
    const token = request.headers
      .get('cookie')
      ?.match(/(?:^|;\s*)agent_session=([A-Za-z0-9_-]+)/)?.[1];
    if (token) sessions.delete(token);
    return text(200, 'Signed out', {
      'Set-Cookie': 'agent_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    });
  }

  return {
    /** The sign-in routes; undefined for every other request. */
    async publicRoute(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      try {
        if (url.pathname === '/auth/sign-in' && request.method === 'GET')
          return await begin(url.origin);
        if (url.pathname === '/auth/callback' && request.method === 'GET')
          return await complete(url);
        if (url.pathname === '/auth/sign-out' && request.method === 'POST')
          return signOut(request, url);
      } catch (error) {
        return text(403, `Sign-in failed: ${(error as Error).message}`);
      }
      return undefined;
    },
    /** The person a session cookie stands for, until the session expires or signs out. */
    async authenticateCookie(token: string): Promise<ExecutionContext | undefined> {
      const session = sessions.get(token);
      if (session && session.expires > now()) return session.context;
      sessions.delete(token);
      return undefined;
    },
  };
}
