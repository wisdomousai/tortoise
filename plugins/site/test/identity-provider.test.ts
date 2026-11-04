import { expect, test } from 'bun:test';
import { sessionCookieName } from '@tortoise/adapters/http';
import { createIdentityProvider } from '../src/testing';
import { createWorkforceSignIn } from '../src/workforce/sign-in';

/** The site plugin's workforce sign-in against the stand-in provider, called in process. */
const origin = 'http://127.0.0.1:4361';
const people = [{ email: 'ana@lab.example', name: 'Ana' }, { email: 'ben@lab.example' }];
const setup = async () => {
  const idp = await createIdentityProvider({
    issuer: 'https://idp.test',
    clientId: 'test-requests',
    people,
  });
  const signIn = createWorkforceSignIn(
    {
      issuer: idp.issuer,
      clientId: 'test-requests',
      principalClaim: 'email',
      scopes: ['openid', 'email'],
      sessionMinutes: 60,
    },
    { fetch: () => idp.fetch, sessions: ':memory:' },
  );
  /** The browser's part: start at the host, then pick `person` on the provider's page. */
  const authorize = async () => {
    const redirect = (await signIn.publicRoute(new Request(`${origin}/auth/sign-in`)))!;
    return new URL(redirect.headers.get('location')!);
  };
  const choose = (location: URL, person: string, change: Record<string, string> = {}) =>
    idp.fetch(`${idp.issuer}/authorize`, {
      method: 'POST',
      body: new URLSearchParams({
        ...Object.fromEntries(location.searchParams),
        person,
        ...change,
      }),
    });
  return { idp, signIn, authorize, choose };
};

test('a person picked on the page signs in as their email', async () => {
  const { idp, signIn, authorize, choose } = await setup();
  const location = await authorize();
  const page = await (await idp.fetch(location)).text();
  expect(page).toContain('Sign in to test-requests');
  expect(page).toContain('value="ana@lab.example"');

  const chosen = await choose(location, 'ana@lab.example');
  expect(chosen.status).toBe(302);
  const callback = new URL(chosen.headers.get('location')!);
  expect(callback.origin + callback.pathname).toBe(`${origin}/auth/callback`);
  const signedIn = (await signIn.publicRoute(new Request(callback)))!;
  expect(signedIn.status).toBe(302);
  const cookie = signedIn.headers
    .get('set-cookie')!
    .match(new RegExp(`${sessionCookieName(origin)}=([^;]+)`))![1]!;
  expect(await signIn.authenticateCookie(cookie)).toMatchObject({
    workspaceId: 'local',
    principalId: 'ana@lab.example',
  });
});

test('the provider refuses an unknown person, a foreign redirect and a replayed or unverified code', async () => {
  const { idp, authorize, choose } = await setup();
  const location = await authorize();
  expect((await choose(location, 'eve@lab.example')).status).toBe(400);
  const foreign = await choose(location, 'ana@lab.example', {
    redirect_uri: 'https://elsewhere.example/auth/callback',
  });
  expect(await foreign.text()).toContain('loopback only');

  const code = new URL(
    (await choose(location, 'ben@lab.example')).headers.get('location')!,
  ).searchParams.get('code')!;
  const exchange = (verifier: string) =>
    idp.fetch(`${idp.issuer}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: 'test-requests',
        redirect_uri: location.searchParams.get('redirect_uri')!,
      }),
    });
  // A wrong verifier spends the code, so no later exchange of it succeeds.
  expect(await (await exchange('not-the-verifier')).json()).toEqual({ error: 'invalid_grant' });
  expect(await (await exchange('any')).json()).toEqual({ error: 'invalid_grant' });
});
