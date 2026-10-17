import { expect, test } from 'bun:test';
import { createApplication, createMemoryStorage } from '@agent-native/runtime';
import { createHttpHandler } from './http';
import { Sessions, type CredentialSource } from './http/sessions';

/** Credentials the host does not store reach the resolver tagged with where they were presented. */
test('a cookie is offered only as a cookie and a bearer only as a bearer, on every recheck', async () => {
  const application = createApplication({
    modules: [],
    storage: createMemoryStorage({}),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [],
  });
  const origin = 'http://127.0.0.1:4100';
  const sessions = new Sessions();
  const seen: [string, CredentialSource][] = [];
  // Like the host: a device token is good only as a bearer, a person's only as a cookie.
  const issued: Record<string, CredentialSource> = { device: 'bearer', person: 'cookie' };
  const handler = createHttpHandler({
    application,
    sessions,
    origin: () => origin,
    authenticateToken: async (token, via) => {
      seen.push([token, via]);
      if (issued[token] !== via) return undefined;
      const context = { workspaceId: 'w', principalId: token };
      return { token, context, expiresAt: Infinity, credential: token, via };
    },
  });
  const get = (headers: Record<string, string>) =>
    handler(
      new Request(`${origin}/api/v1/contract`, { headers: { host: '127.0.0.1:4100', ...headers } }),
    );
  expect((await get({ cookie: 'agent_session=person' })).status).toBe(200);
  expect((await get({ authorization: 'Bearer device' })).status).toBe(200);
  // A device token in a cookie, or a person's cookie token as a bearer, is refused.
  expect((await get({ cookie: 'agent_session=device' })).status).toBe(403);
  expect((await get({ authorization: 'Bearer person' })).status).toBe(403);
  // A bearer wins over a cookie; the cookie is not offered at all.
  seen.length = 0;
  await get({ authorization: 'Bearer device', cookie: 'agent_session=person' });
  expect(seen).toEqual([['device', 'bearer']]);

  // A browser session minted from a cookie credential rechecks it as a cookie.
  const minted = sessions.create(
    { workspaceId: 'w', principalId: 'person' },
    undefined,
    'person',
    'cookie',
  );
  seen.length = 0;
  expect((await get({ cookie: `agent_session=${minted.token}` })).status).toBe(200);
  expect(seen).toEqual([['person', 'cookie']]);
  delete issued.person;
  expect((await get({ cookie: `agent_session=${minted.token}` })).status).toBe(403);
  expect(sessions.get(minted.token)).toBeUndefined();
});
