import { expect, test } from 'bun:test';
import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { createApplication, createHandlerFactory, createMemoryStorage } from '@tortoise/runtime';
import { createHttpHandler } from './http';
import { sessionCookieName } from './http/session-cookie';
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
  const cookie = (token: string) => `${sessionCookieName(origin)}=${token}`;
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
  expect((await get({ cookie: cookie('person') })).status).toBe(200);
  expect((await get({ authorization: 'Bearer device' })).status).toBe(200);
  // A device token in a cookie, or a person's cookie token as a bearer, is refused.
  expect((await get({ cookie: cookie('device') })).status).toBe(403);
  expect((await get({ authorization: 'Bearer person' })).status).toBe(403);
  // A bearer wins over a cookie; the cookie is not offered at all.
  seen.length = 0;
  await get({ authorization: 'Bearer device', cookie: cookie('person') });
  expect(seen).toEqual([['device', 'bearer']]);

  // A browser session created from a cookie credential rechecks it as a cookie.
  const created = sessions.create(
    { workspaceId: 'w', principalId: 'person' },
    undefined,
    'person',
    'cookie',
  );
  seen.length = 0;
  expect((await get({ cookie: cookie(created.token) })).status).toBe(200);
  expect(seen).toEqual([['person', 'cookie']]);
  delete issued.person;
  expect((await get({ cookie: cookie(created.token) })).status).toBe(403);
  expect(sessions.get(created.token)).toBeUndefined();
});

/** Browsers send one host's cookies to every port on it, so each port names its own session. */
test('two hosts on one machine each set and read only their own session cookie', async () => {
  const application = createApplication({
    modules: [],
    storage: createMemoryStorage({}),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [],
  });
  const host = (port: number) => {
    const origin = `http://127.0.0.1:${port}`;
    const sessions = new Sessions();
    const handler = createHttpHandler({ application, sessions, origin: () => origin });
    const send = (path: string, headers: Record<string, string> = {}, body?: unknown) =>
      handler(
        new Request(`${origin}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { host: `127.0.0.1:${port}`, origin, ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return { origin, sessions, send };
  };
  const fleet = host(4340);
  const agent = host(4359);
  const signIn = async (at: ReturnType<typeof host>) => {
    const launch = at.sessions.launch(
      at.sessions.create({ workspaceId: 'w', principalId: at.origin }),
    );
    const json = { 'content-type': 'application/json' };
    const response = await at.send('/api/v1/session', json, { launch });
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  const fleetCookie = await signIn(fleet);
  const agentCookie = await signIn(agent);
  expect(fleetCookie).toStartWith('agent_session_4340=');
  expect(agentCookie).toStartWith('agent_session_4359=');
  // The browser sends both cookies to both ports; each host reads its own.
  const both = { cookie: `${fleetCookie}; ${agentCookie}` };
  expect((await fleet.send('/api/v1/contract', both)).status).toBe(200);
  expect((await agent.send('/api/v1/contract', both)).status).toBe(200);
  expect((await agent.send('/api/v1/contract', { cookie: fleetCookie })).status).toBe(403);
  expect(sessionCookieName('https://plant.example')).toBe('agent_session');
  expect(sessionCookieName('https://plant.example:8443')).toBe('agent_session_8443');
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
      requests.push(request?.headers.get('tortoise-subject') ?? '');
      const subject = request?.headers.get('tortoise-subject');
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
          ...(subject ? { 'tortoise-subject': subject } : {}),
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

/** A request runs as its session only while the session lasts; ending it mid-request cancels it. */
test('a session revoked or ended by its credential during a request stops the command', async () => {
  const add = defineCapability({
    id: 'counter.add',
    kind: 'command',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.number().int()),
    permission: { action: 'update', resourceType: 'counter' },
    ui: { exception: 'test fixture' },
  });
  const get = defineCapability({
    id: 'counter.get',
    kind: 'query',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.number().int()),
    permission: { action: 'read', resourceType: 'counter' },
    ui: { exception: 'test fixture' },
  });
  const storage = createMemoryStorage<{ count: number }>({ count: 0 });
  const bind = createHandlerFactory<{ count: number }, {}>();
  let during: () => void = () => {};
  const application = createApplication({
    modules: [defineModule({ id: 'counter', capabilities: [add, get] })],
    storage,
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    handlers: [
      bind(add, async (_, ctx) => {
        ctx.state.count += 1;
        ctx.change('counter:one');
        during();
        await Promise.resolve();
        return ctx.state.count;
      }),
      bind(get, (_, ctx) => ctx.state.count),
    ],
  });
  const origin = 'http://127.0.0.1:4100';
  const sessions = new Sessions();
  const ended = new AbortController();
  const handler = createHttpHandler({
    application,
    sessions,
    origin: () => origin,
    // A plugin credential that carries its own signal, as a signed-in person's cookie does.
    authenticateToken: async (token, via) =>
      token === 'person'
        ? {
            token,
            context: { workspaceId: 'w', principalId: 'person', signal: ended.signal },
            expiresAt: Infinity,
            credential: token,
            via,
          }
        : undefined,
  });
  const add1 = (token: string) =>
    handler(
      new Request(`${origin}/api/v1/commands/counter.add`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:4100',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ input: {}, idempotencyKey: crypto.randomUUID() }),
      }),
    );
  const owner = { workspaceId: 'w', principalId: 'owner' };
  const count = async () =>
    (await application.query({ operation: 'counter.get', input: {} }, owner)).data;
  const session = sessions.create({ workspaceId: 'w', principalId: 'owner' });
  expect((await add1(session.token)).status).toBe(200);
  expect(await count()).toBe(1);

  during = () => sessions.revoke(session.token);
  const revoked = await add1(session.token);
  expect(((await revoked.json()) as { error: { code: string } }).error.code).toBe('CANCELLED');
  expect(await count()).toBe(1);
  expect((await add1(session.token)).status).toBe(403);

  during = () => ended.abort();
  const signedOut = await add1('person');
  expect(((await signedOut.json()) as { error: { code: string } }).error.code).toBe('CANCELLED');
  expect(await count()).toBe(1);
});
