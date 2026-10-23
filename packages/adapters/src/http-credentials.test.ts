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

/** A peer acting for a person reaches operations only, and its resolver sees the signed request. */
test('a call on behalf of a person opens no launch session or event stream', async () => {
  const application = createApplication({
    modules: [],
    storage: createMemoryStorage({}),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [],
  });
  const origin = 'http://127.0.0.1:4100';
  const requests: string[] = [];
  const handler = createHttpHandler({
    application,
    sessions: new Sessions(),
    origin: () => origin,
    authenticateToken: async (token, via, request) => {
      requests.push(request?.headers.get('agent-native-subject') ?? '');
      const subject = request?.headers.get('agent-native-subject');
      const context = {
        workspaceId: 'w',
        principalId: subject ? 'ann' : 'peer:receiving',
        peer: { id: 'receiving', ...(subject ? { subject } : {}) },
      };
      return { token, context, expiresAt: Infinity, credential: token, via };
    },
  });
  const call = (path: string, method: string, subject?: string) =>
    handler(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          host: '127.0.0.1:4100',
          authorization: 'Bearer peer',
          ...(subject ? { 'agent-native-subject': subject } : {}),
        },
      }),
    );
  expect((await call('/api/v1/launch', 'POST', 'v1.rita')).status).toBe(403);
  expect((await call('/api/v1/events', 'GET', 'v1.rita')).status).toBe(403);
  expect((await call('/api/v1/contract', 'GET', 'v1.rita')).status).toBe(200);
  // As its own service principal, the peer may still open a launch session.
  expect((await call('/api/v1/launch', 'POST')).status).toBe(200);
  expect(requests).toEqual(['v1.rita', 'v1.rita', 'v1.rita', '']);
});
