import { expect, test } from 'bun:test';
import {
  createHttpHandler,
  sessionCookieName,
  Sessions,
  type ApplicationPort,
} from '@agent-native/adapters/http';
import {
  createApplication,
  createMemoryStorage,
  type ExecutionContext,
} from '@agent-native/runtime';
import {
  createServiceHandlers,
  createServiceState,
  servicePolicy,
  fieldServiceModule,
} from '../server';
import { startHost } from '@agent-native/host/host';
import fieldService from '../application';
import type { Harness } from '@agent-native/agents/types';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = 'http://127.0.0.1:8123';
function request(
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:8123',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture() {
  let seen: ExecutionContext | undefined;
  const application: ApplicationPort = {
    async queryRaw(_, context) {
      seen = context;
      return { data: { principal: context.principalId }, cursor: 0, authorizationRevision: 0 };
    },
    async invokeRaw(_, context) {
      seen = context;
      return {
        operation: 'test.write',
        result: {},
        revisions: {},
        cursor: 0,
        authorizationRevision: 0,
      };
    },
    async events() {
      return { events: [], cursor: 0, authorizationRevision: 0 };
    },
    async deliverEvents(_, _context, deliver) {
      deliver({ events: [], cursor: 0, authorizationRevision: 0 });
    },
    discover() {
      return {
        formatVersion: 1,
        operations: [],
        workflows: [],
        agents: [],
        requirements: { network: [], folders: [], devices: [], processes: [] },
      };
    },
  };
  const sessions = new Sessions();
  const session = sessions.create({ workspaceId: 'w', principalId: 'customer' });
  return {
    application,
    sessions,
    session,
    seen: () => seen,
    handler: createHttpHandler({ application, sessions, origin: () => origin, pollMs: 1 }),
  };
}

test('HTTP boundary rejects spoofed Host, Origin, unauthenticated and cross-site requests', async () => {
  const { handler, session } = fixture();
  expect(
    (
      await handler(
        request('/api/v1/contract', session.token, undefined, { host: 'attacker.invalid' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handler(
        request('/api/v1/contract', session.token, undefined, {
          origin: 'https://attacker.invalid',
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handler(
        request('/api/v1/contract', session.token, undefined, { 'sec-fetch-site': 'cross-site' }),
      )
    ).status,
  ).toBe(403);
  expect((await handler(request('/api/v1/contract'))).status).toBe(403);
});

test('real host preserves delegated grants for runs and isolates runs across workspaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-http-host-'));
  let workOrderId = '';
  const attempts: Harness = {
    id: 'security-attempt',
    features: { questions: false, approvals: false, resume: false },
    async availability() {
      return { available: true };
    },
    async *run(turn) {
      await turn.tools.execute(
        'task.create',
        { input: { workOrderId, title: 'Must be denied' } },
        { runId: turn.runId, signal: turn.signal, idempotencyKey: 'attempt' },
      );
    },
  };
  const hold: Harness = {
    id: 'security-hold',
    features: { questions: false, approvals: false, resume: false },
    async availability() {
      return { available: true };
    },
    async *run(turn) {
      if (!turn.signal.aborted)
        await new Promise<void>((resolve) =>
          turn.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
    },
  };
  const host = await startHost(fieldService, {
    workspacePath: directory,
    harnesses: [attempts, hold],
    pollMs: 1,
  });
  const call = async (path: string, token: string, body?: unknown) =>
    fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const created = await host.application.invokeRaw(
      {
        operation: 'work-order.create',
        input: { name: 'Security work order' },
        idempotencyKey: 'work-order',
      },
      { principalId: 'owner', workspaceId: 'local' },
    );
    workOrderId = (created.result as { id: string }).id;
    const narrow = host.sessions.create({
      principalId: 'owner',
      workspaceId: 'local',
      grant: { operations: ['task.list'] },
    });
    const response = await call('/api/v1/runs', narrow.token, {
      harnessId: attempts.id,
      prompt: 'Attempt forbidden mutation',
    });
    expect([202, 403]).toContain(response.status);
    if (response.status === 202) {
      const run = (await response.json()) as { id: string };
      for (let i = 0; i < 200; i++) {
        const current = await host.supervisor.get(run.id);
        if (current && ['failed', 'cancelled', 'succeeded'].includes(current.state)) break;
        await Bun.sleep(5);
      }
      expect((await host.supervisor.get(run.id))?.state).toBe('failed');
    }
    expect(
      (
        await host.application.queryRaw(
          { operation: 'task.list', input: {} },
          { principalId: 'owner', workspaceId: 'local' },
        )
      ).data,
    ).toMatchObject({ count: 0 });
    const ownerToken = host.sessions.create({ principalId: 'owner', workspaceId: 'local' });
    const selected = `work-order:${workOrderId}`;
    const ui = (await (
      await call('/api/v1/ui/sessions', ownerToken.token, {
        selectedResources: [selected],
        observedRevisions: { [selected]: 1 },
      })
    ).json()) as { sessionId: string; version: number };
    expect(typeof ui.sessionId).toBe('string');
    const otherCredential = host.sessions.create(ownerToken.context);
    expect(
      (
        await call('/api/v1/runs', otherCredential.token, {
          harnessId: hold.id,
          prompt: 'Wrong UI credential',
          uiSessionId: ui.sessionId,
        })
      ).status,
    ).toBe(404);
    const started = (await (
      await call('/api/v1/runs', ownerToken.token, {
        harnessId: hold.id,
        prompt: 'Hold',
        principalId: 'forged',
        workspaceId: 'forged',
        uiSessionId: ui.sessionId,
      })
    ).json()) as {
      id: string;
      context: {
        principalId: string;
        workspaceId: string;
        uiContext: { selectedResources: string[] };
      };
    };
    expect(started.context.principalId).toBe('owner');
    expect(started.context.workspaceId).toBe('local');
    expect(started.context.uiContext.selectedResources).toEqual([selected]);
    expect(
      (
        await call(`/api/v1/ui/sessions/${ui.sessionId}`, ownerToken.token, {
          context: { selectedResources: [], observedRevisions: {} },
          expectedVersion: ui.version,
        })
      ).status,
    ).toBe(200);
    expect((await host.supervisor.get(started.id))?.context.uiContext).toMatchObject({
      selectedResources: [selected],
    });
    expect(
      (
        await call('/api/v1/runs', ownerToken.token, {
          harnessId: hold.id,
          prompt: 'Selection changed before start',
          uiSessionId: ui.sessionId,
          uiContextVersion: ui.version,
        })
      ).status,
    ).toBe(409);
    const intent = (await (
      await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`, ownerToken.token, {
        type: 'openResource',
        resource: selected,
      })
    ).json()) as { id: string };
    expect(
      await (await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`, ownerToken.token)).json(),
    ).toMatchObject([{ id: intent.id, intent: { resource: selected } }]);
    expect(
      (
        await call(`/api/v1/ui/sessions/${ui.sessionId}/ack`, ownerToken.token, {
          id: intent.id,
          status: 'accepted',
        })
      ).status,
    ).toBe(200);
    expect(
      await (await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`, ownerToken.token)).json(),
    ).toEqual([]);
    const other = host.sessions.create({ principalId: 'owner', workspaceId: 'other' });
    expect(await (await call('/api/v1/runs', other.token)).json()).toEqual([]);
    expect((await call(`/api/v1/runs/${started.id}/cancel`, other.token, {})).status).toBe(404);
    expect((await call(`/api/v1/runs/${started.id}/cancel`, ownerToken.token, {})).status).toBe(
      200,
    );
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('request fields cannot select identity, browser cookie writes require Origin, commands require receipt keys', async () => {
  const { handler, session, seen } = fixture();
  const response = await handler(
    request('/api/v1/queries/test.read', session.token, {
      input: {},
      principalId: 'owner',
      roles: ['owner'],
      workspaceId: 'other',
    }),
  );
  expect(response.status).toBe(200);
  expect(seen()?.principalId).toBe('customer');
  expect(seen()?.workspaceId).toBe('w');
  expect(
    (await handler(request('/api/v1/commands/test.write', session.token, { input: {} }))).status,
  ).toBe(400);
  const cookieOnly = request(
    '/api/v1/commands/test.write',
    undefined,
    { input: {}, idempotencyKey: 'x' },
    { cookie: `${sessionCookieName(origin)}=${session.token}` },
  );
  expect((await handler(cookieOnly)).status).toBe(403);
  const valid = await handler(
    request(
      '/api/v1/commands/test.write',
      undefined,
      { input: {}, idempotencyKey: 'x' },
      { cookie: `${sessionCookieName(origin)}=${session.token}`, origin },
    ),
  );
  expect(valid.status).toBe(200);
  expect(valid.headers.get('cache-control')).toBe('no-store');
});

test('launch credentials are single-use and revocation also invalidates pending launches', async () => {
  const { handler, sessions, session } = fixture();
  const key = sessions.launch(session);
  expect((await handler(request('/api/v1/session', undefined, { launch: key }))).status).toBe(200);
  expect((await handler(request('/api/v1/session', undefined, { launch: key }))).status).toBe(403);
  const revoked = sessions.launch(session);
  sessions.revoke(session.token);
  expect((await handler(request('/api/v1/session', undefined, { launch: revoked }))).status).toBe(
    403,
  );
});

test('revoking a session during awaited event authorization prevents the final enqueue', async () => {
  const { application, handler, sessions, session } = fixture();
  let start!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => {
    start = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  application.deliverEvents = async (_, _context, deliver) => {
    start();
    await release;
    deliver({
      cursor: 1,
      authorizationRevision: 0,
      events: [
        {
          cursor: 1,
          resource: 'task:protected-id',
          operation: 'task.update',
          type: 'changed',
          revision: 1,
        },
      ],
    });
  };
  const snapshot = await (
    await handler(request('/api/v1/queries/test.read', session.token, { input: {} }))
  ).json();
  const response = await handler(
    request(`/api/v1/events?cursor=${encodeURIComponent(snapshot.cursor)}`, session.token),
  );
  const reader = response.body!.getReader();
  try {
    const next = reader.read();
    await entered;
    sessions.revoke(session.token);
    finish();
    expect((await next).done).toBe(true);
  } finally {
    finish();
    await reader.cancel();
  }
});

test('SSE resets after revocation without returning newly forbidden resource identifiers', async () => {
  const initial = createServiceState();
  initial.workOrders.shared = {
    id: 'shared',
    name: 'Shared',
    closed: false,
    members: { customer: 'customer' },
  };
  initial.tasks.secretId = {
    id: 'secretId',
    workOrderId: 'shared',
    title: 'Visible until revoked',
    description: '',
    status: 'todo',
  };
  const app = createApplication({
    modules: [fieldServiceModule],
    handlers: createServiceHandlers(),
    storage: createMemoryStorage(initial),
    authorization: servicePolicy,
    services: {},
  });
  const sessions = new Sessions();
  const customer = sessions.create({ principalId: 'customer', workspaceId: 'w' });
  const handler = createHttpHandler({
    application: app,
    sessions,
    origin: () => origin,
    pollMs: 1,
  });
  const snapshot = await (
    await handler(request('/api/v1/queries/task.list', customer.token, { input: {} }))
  ).json();
  await app.invokeRaw(
    {
      operation: 'work-order.set-member',
      input: { id: 'shared', principalId: 'customer', role: null },
      idempotencyKey: 'revoke',
    },
    { principalId: 'owner', workspaceId: 'w' },
  );
  const response = await handler(
    request(`/api/v1/events?cursor=${encodeURIComponent(snapshot.cursor)}`, customer.token),
  );
  const reader = response.body!.getReader();
  try {
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('"reset":true');
    expect(frame).toContain('"changes":[]');
    expect(frame).not.toContain('secretId');
    expect(frame).not.toContain('work-order:shared');
  } finally {
    await reader.cancel();
  }
});

test('HTTP projections agree across sessions and SSE replays the query/subscription gap with session-bound cursors', async () => {
  const initial = createServiceState();
  initial.workOrders.shared = {
    id: 'shared',
    name: 'Shared',
    closed: false,
    members: { customer: 'customer' },
  };
  initial.tasks.one = {
    id: 'one',
    workOrderId: 'shared',
    title: 'One',
    description: '',
    internalNote: 'HTTP PRIVATE FIELD',
    status: 'todo',
  };
  const app = createApplication({
    modules: [fieldServiceModule],
    handlers: createServiceHandlers(),
    storage: createMemoryStorage(initial),
    authorization: servicePolicy,
    services: {},
  });
  const sessions = new Sessions();
  const owner = sessions.create({ principalId: 'owner', workspaceId: 'w' });
  const customer = sessions.create({ principalId: 'customer', workspaceId: 'w' });
  const handler = createHttpHandler({
    application: app,
    sessions,
    origin: () => origin,
    pollMs: 1,
  });
  const ownerSnapshot = await (
    await handler(request('/api/v1/queries/task.list', owner.token, { input: {} }))
  ).json();
  const customerSnapshot = await (
    await handler(request('/api/v1/queries/task.list', customer.token, { input: {} }))
  ).json();
  expect(ownerSnapshot.data.items[0].internalNote).toBe('HTTP PRIVATE FIELD');
  expect(customerSnapshot.data.items[0]).not.toHaveProperty('internalNote');
  expect(
    (
      await handler(
        request('/api/v1/commands/task.set-status', customer.token, {
          input: { id: 'one', status: 'done' },
          idempotencyKey: 'customer-edit',
        }),
      )
    ).status,
  ).toBe(403);
  // This commit occurs after the snapshot but before the frontend subscribes.
  await app.invokeRaw(
    {
      operation: 'task.set-status',
      input: { id: 'one', status: 'doing' },
      idempotencyKey: 'gap-update',
    },
    owner.context,
  );
  const readFrame = async (token: string, cursor: string) => {
    const response = await handler(
      request(`/api/v1/events?cursor=${encodeURIComponent(cursor)}`, token),
    );
    const reader = response.body!.getReader();
    try {
      const text = new TextDecoder().decode((await reader.read()).value);
      return JSON.parse(text.slice('data: '.length).trim());
    } finally {
      await reader.cancel();
    }
  };
  const replay = await readFrame(customer.token, customerSnapshot.cursor);
  expect(replay.reset).toBe(false);
  expect(replay.changes).toMatchObject([
    { resource: 'task:one', operation: 'task.set-status', revision: 1 },
  ]);
  expect(JSON.stringify(replay)).not.toContain('HTTP PRIVATE FIELD');
  const resumed = await readFrame(customer.token, replay.cursor);
  expect(resumed.changes).toEqual([]);
  expect(resumed.reset).toBe(false);
  // A different valid session cannot use another session's cursor to infer event history.
  const stolen = await readFrame(owner.token, customerSnapshot.cursor);
  expect(stolen.reset).toBe(true);
  expect(stolen.changes).toEqual([]);
});

test('run history is grant-scoped and free-form output disappears after authorization changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'run-history-'));
  const host = await startHost(fieldService, { workspacePath: directory });
  try {
    const context = { workspaceId: 'local', principalId: 'owner' };
    const owner = host.sessions.create(context);
    const restricted = host.sessions.create({ ...context, grant: { operations: ['task.list'] } });
    const call = (token: string, path: string, body?: unknown) =>
      fetch(host.url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const response = await call(owner.token, '/api/v1/runs', {
      harnessId: 'deterministic',
      prompt: JSON.stringify({ commands: [], text: 'formerly-visible-work-order-detail' }),
    });
    expect(response.status).toBe(202);
    const run = (await response.json()) as { id: string };
    for await (const _event of host.supervisor.events(run.id)) {
      /* Await terminal state without sleeps. */
    }
    expect(await (await call(owner.token, '/api/v1/runs')).text()).toContain(
      'formerly-visible-work-order-detail',
    );
    expect(await (await call(restricted.token, '/api/v1/runs')).json()).toEqual([]);
    expect((await call(restricted.token, `/api/v1/runs/${run.id}/cancel`, {})).status).toBe(404);
    await host.application.invokeRaw(
      { operation: 'work-order.create', input: { name: 'Permission generation changes' } },
      context,
    );
    const history = await (await call(owner.token, '/api/v1/runs')).text();
    expect(history).not.toContain('formerly-visible-work-order-detail');
    expect(history).toContain('historyUnavailable');
    const nested = host.sessions.create({ ...context, runId: 'parent-run' });
    expect(
      (
        await call(nested.token, '/api/v1/runs', {
          harnessId: 'deterministic',
          prompt: '{"commands":[]}',
        })
      ).status,
    ).toBe(403);
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a run started from a UI session reaches that screen through the ui tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-ui-intents-'));
  const seen: { tools: string[]; result?: unknown; error?: string }[] = [];
  let target = '';
  const screen: Harness = {
    id: 'screen-intents',
    features: { questions: false, approvals: false, resume: false },
    async availability() {
      return { available: true };
    },
    async *run(turn) {
      const entry: (typeof seen)[number] = {
        tools: (turn.tools.definitions ?? []).map((tool) => tool.operation),
      };
      seen.push(entry);
      try {
        entry.result = await turn.tools.execute(
          'ui.open',
          { input: { resource: target } },
          { runId: turn.runId, signal: turn.signal, idempotencyKey: 'open' },
        );
      } catch (error) {
        entry.error = (error as { code?: string }).code;
      }
    },
  };
  const host = await startHost(fieldService, {
    workspacePath: directory,
    harnesses: [screen],
    pollMs: 1,
  });
  const owner = host.sessions.create({ principalId: 'owner', workspaceId: 'local' });
  const call = async (path: string, body?: unknown) =>
    fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const completed = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const run = await host.supervisor.get(id);
      if (run && ['failed', 'cancelled', 'succeeded'].includes(run.state)) return run.state;
      await Bun.sleep(5);
    }
  };
  try {
    const created = await host.application.invokeRaw(
      { operation: 'work-order.create', input: { name: 'Screen work order' }, idempotencyKey: 'p' },
      owner.context,
    );
    target = `work-order:${(created.result as { id: string }).id}`;
    const ui = (await (
      await call('/api/v1/ui/sessions', {
        selectedResources: [target],
        observedRevisions: { [target]: 1 },
      })
    ).json()) as { sessionId: string };

    const fromScreen = (await (
      await call('/api/v1/runs', {
        harnessId: screen.id,
        prompt: 'Open it',
        uiSessionId: ui.sessionId,
      })
    ).json()) as { id: string };
    await completed(fromScreen.id);
    expect(seen[0]?.tools).toEqual(expect.arrayContaining(['ui.open', 'ui.request-review']));
    expect(seen[0]?.result).toMatchObject({ status: 'pending' });
    expect(await (await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`)).json()).toMatchObject([
      { intent: { type: 'openResource', resource: target } },
    ]);

    const headless = (await (
      await call('/api/v1/runs', { harnessId: screen.id, prompt: 'No screen' })
    ).json()) as { id: string };
    await completed(headless.id);
    expect(seen[1]?.tools).not.toContain('ui.open');
    expect(seen[1]?.error).toBe('NOT_FOUND');

    target = 'work-order:missing';
    const unreadable = (await (
      await call('/api/v1/runs', {
        harnessId: screen.id,
        prompt: 'Open a work order that does not exist',
        uiSessionId: ui.sessionId,
      })
    ).json()) as { id: string };
    await completed(unreadable.id);
    expect(seen[2]?.error).toBeDefined();
    expect(await (await call(`/api/v1/ui/sessions/${ui.sessionId}/intents`)).json()).toHaveLength(
      1,
    );
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
