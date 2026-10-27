import { beforeAll, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import type { ResolvedPolicy } from '../src/policy';
import { createWorkforceSignIn, type WorkforceConfig } from '../src/workforce/sign-in';

/**
 * Workforce sign-in against a fake identity provider: discovery, keys and the token endpoint are
 * answered by the injected destination fetch, as the network port's client would reach them.
 */
const issuer = 'https://idp.example';
const origin = 'https://station.example';
const config: WorkforceConfig = {
  issuer,
  clientId: 'site-app',
  principalClaim: 'email',
  scopes: ['openid', 'email'],
  sessionMinutes: 60,
};
let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
});

/** A provider whose ID tokens `claims` can alter, and the token requests it saw. */
function provider(options: { claims?: Record<string, unknown>; discoveryIssuer?: string } = {}) {
  const codes = new Map<string, string>();
  const requests: URLSearchParams[] = [];
  const fetch = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/.well-known/openid-configuration')
      return Response.json({
        issuer: options.discoveryIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    if (url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body));
      requests.push(body);
      const nonce = codes.get(body.get('code') ?? '');
      if (!nonce) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const idToken = await new SignJWT({
        nonce,
        email: 'ada@plant.example',
        email_verified: true,
        ...options.claims,
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(String(options.claims?.aud ?? config.clientId))
        .setSubject('u-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return Response.json({ id_token: idToken, access_token: 'a', token_type: 'Bearer' });
    }
    return new Response('not found', { status: 404 });
  };
  /** What the provider does after the person signs in: issue a code bound to the nonce. */
  const authorize = (location: string) => {
    const url = new URL(location);
    const code = `code-${codes.size}`;
    codes.set(code, url.searchParams.get('nonce')!);
    return `${origin}/auth/callback?code=${code}&state=${url.searchParams.get('state')}`;
  };
  return { fetch, authorize, requests };
}

const get = (path: string) => new Request(new URL(path, origin));
const cookieOf = (response: Response) =>
  response.headers.get('set-cookie')?.match(/agent_session=([^;]+)/)?.[1] ?? '';

test('a person signs in with PKCE and the session cookie stands for the verified principal', async () => {
  const idp = provider();
  let now = Date.now();
  const signIn = createWorkforceSignIn(config, { fetch: () => idp.fetch, now: () => now });
  const redirect = (await signIn.publicRoute(get('/auth/sign-in')))!;
  expect(redirect.status).toBe(302);
  const location = new URL(redirect.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(`${issuer}/authorize`);
  expect(Object.fromEntries(location.searchParams)).toMatchObject({
    response_type: 'code',
    client_id: 'site-app',
    redirect_uri: `${origin}/auth/callback`,
    scope: 'openid email',
    code_challenge_method: 'S256',
  });

  const callback = idp.authorize(location.toString());
  const signedIn = (await signIn.publicRoute(get(callback)))!;
  expect(signedIn.status).toBe(302);
  expect(signedIn.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/');
  expect(signedIn.headers.get('set-cookie')).toContain('Secure');
  // The verifier sent to the token endpoint is the one the challenge was made from.
  const verifier = idp.requests[0]!.get('code_verifier')!;
  const challenge = new Bun.CryptoHasher('sha256').update(verifier).digest('base64url');
  expect(challenge).toBe(location.searchParams.get('code_challenge')!);

  const token = cookieOf(signedIn);
  expect(await signIn.authenticateCookie(token)).toEqual({
    workspaceId: 'local',
    principalId: 'ada@plant.example',
  });
  // The state is used once: the same callback again is refused.
  expect((await signIn.publicRoute(get(callback)))!.status).toBe(403);
  // Signing out needs this origin, then ends the session.
  const signOut = (headers: Record<string, string>) =>
    signIn.publicRoute(
      new Request(`${origin}/auth/sign-out`, {
        method: 'POST',
        headers: { cookie: `agent_session=${token}`, ...headers },
      }),
    );
  expect((await signOut({ origin: 'https://other.example' }))!.status).toBe(403);
  expect(await signIn.authenticateCookie(token)).toBeDefined();
  expect((await signOut({ origin }))!.status).toBe(200);
  expect(await signIn.authenticateCookie(token)).toBeUndefined();

  // A session ends after sessionMinutes.
  const again = (await signIn.publicRoute(get('/auth/sign-in')))!;
  const second = cookieOf(
    (await signIn.publicRoute(get(idp.authorize(again.headers.get('location')!))))!,
  );
  now += 61 * 60_000;
  expect(await signIn.authenticateCookie(second)).toBeUndefined();
  expect(await signIn.publicRoute(get('/api/v1/catalog'))).toBeUndefined();
});

test('a forged state, another audience, an unverified email or a foreign issuer is refused', async () => {
  const refused = async (idp: ReturnType<typeof provider>, alter = (url: string) => url) => {
    const signIn = createWorkforceSignIn(config, { fetch: () => idp.fetch });
    const redirect = (await signIn.publicRoute(get('/auth/sign-in')))!;
    if (redirect.status !== 302) return redirect;
    return (await signIn.publicRoute(
      get(alter(idp.authorize(redirect.headers.get('location')!))),
    ))!;
  };
  const forged = await refused(provider(), (url) => url.replace(/state=[^&]+/, 'state=forged'));
  expect(forged.status).toBe(403);
  expect(await forged.text()).toContain('expired or was already used');
  expect((await refused(provider({ claims: { aud: 'another-app' } }))).status).toBe(403);
  const unverified = await refused(provider({ claims: { email_verified: false } }));
  expect(await unverified.text()).toContain('not verified this email');
  const foreign = await refused(provider({ discoveryIssuer: 'https://evil.example' }));
  expect(foreign.status).toBe(403);
  expect(await foreign.text()).toContain('names another issuer');
});

test('under external identity an embedded call needs a grant; the serving host starts without one', async () => {
  const { assertIdentity } = await import('../src/identity');
  const policy = {
    profile: 'sandbox',
    policy: { identity: 'external', grants: { maxTtlSeconds: 600 } },
  } as unknown as ResolvedPolicy;
  expect(() => assertIdentity(policy, undefined, false)).toThrow(
    /embedded calls need a delegated grant/,
  );
  expect(() => assertIdentity(policy, undefined, true)).not.toThrow();
  const grant = { operations: ['work-order.list'], expiresAt: Date.now() + 60_000 };
  expect(() =>
    assertIdentity(policy, { workspaceId: 'local', principalId: 'agent', grant }, false),
  ).not.toThrow();
});
