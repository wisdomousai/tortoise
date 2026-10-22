import { expect, test } from 'bun:test';
import { ApplicationError } from '@agent-native/contracts';
import { createApplication, createMemoryStorage } from '@agent-native/runtime';
import { Sessions } from '@agent-native/adapters/http';
import { UiSessionStore } from '@agent-native/adapters/ui-sessions';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
} from '../server';

test('UI capture resolves authorized resources and binds to live host identity and credential', async () => {
  const state = createProjectTaskState();
  state.projects.p = { id: 'p', name: 'Shared', archived: false, members: { viewer: 'viewer' } };
  state.tasks.one = { id: 'one', projectId: 'p', title: 'One', description: '', status: 'todo' };
  const app = createApplication({
    modules: [projectTasksModule],
    handlers: createProjectTaskHandlers(),
    storage: createMemoryStorage(state),
    authorization: projectTaskPolicy,
    services: {},
  });
  const sessions = new Sessions();
  const viewer = sessions.create({ principalId: 'viewer', workspaceId: 'w' });
  const store = new UiSessionStore({
    isActive: (token) => !!sessions.get(token),
    async validateContext(context, value) {
      for (const resource of value.selectedResources) {
        const [type, id] = resource.split(':');
        const result = await app.queryRaw({ operation: `${type}.get`, input: { id } }, context);
        if ((result.data as { revision: number }).revision !== value.observedRevisions[resource])
          throw new ApplicationError('CONFLICT', 'Observed revision changed');
      }
    },
    async validateIntent(context, intent) {
      if (intent.type !== 'requestReview') {
        const [type, id] = intent.resource.split(':');
        await app.queryRaw({ operation: `${type}.get`, input: { id } }, context);
      }
    },
  });
  const original = { selectedResources: ['task:one'], observedRevisions: { 'task:one': 0 } };
  const context = await store.register(viewer, original);
  original.selectedResources[0] = 'task:forged';
  expect((await store.capture(viewer, context.sessionId)).selectedResources).toEqual(['task:one']);
  const differentCredential = sessions.create(viewer.context);
  await expect(store.capture(differentCredential, context.sessionId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const forgedWorkspace = { ...viewer, context: { ...viewer.context, workspaceId: 'other' } };
  await expect(store.capture(forgedWorkspace, context.sessionId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const pending = await store.send(viewer, context.sessionId, {
    type: 'selectResource',
    resource: 'task:one',
  });
  await app.invokeRaw(
    { operation: 'project.set-member', input: { id: 'p', principalId: 'viewer', role: null } },
    { principalId: 'owner', workspaceId: 'w' },
  );
  expect(await store.poll(viewer, context.sessionId)).toEqual([]);
  expect(store.status(viewer, context.sessionId, pending)).toBe('rejected');
  await expect(store.capture(viewer, context.sessionId)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  sessions.revoke(viewer.token);
  await expect(store.poll(viewer, context.sessionId)).rejects.toThrow('Active UI host');
});

test('UI contexts have revisions and immutable captures; intents replay until acknowledgement and expire', async () => {
  let now = 0;
  const sessions = new Sessions(() => now);
  const owner = sessions.create({ principalId: 'owner', workspaceId: 'w' });
  const store = new UiSessionStore({
    now: () => now,
    isActive: (token) => !!sessions.get(token),
    validateContext: async () => {},
    validateIntent: async () => {},
    intentTtlMs: 100,
    sessionTtlMs: 1000,
  });
  const first = await store.register(owner, {
    selectedResources: ['task:one'],
    observedRevisions: { 'task:one': 1 },
  });
  const captured = await store.capture(owner, first.sessionId);
  const changed = await store.update(
    owner,
    first.sessionId,
    { selectedResources: ['task:two'], observedRevisions: { 'task:two': 2 } },
    1,
  );
  expect(changed.version).toBe(2);
  expect(captured.selectedResources).toEqual(['task:one']);
  expect(Object.isFrozen(captured.selectedResources)).toBe(true);
  await expect(
    store.update(owner, first.sessionId, { selectedResources: [], observedRevisions: {} }, 1),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const id = await store.send(owner, first.sessionId, {
    type: 'selectResource',
    resource: 'task:two',
  });
  expect(await store.poll(owner, first.sessionId)).toHaveLength(1);
  expect((await store.poll(owner, first.sessionId))[0]?.id).toBe(id);
  expect(store.acknowledge(owner, first.sessionId, id, 'accepted')).toBe('accepted');
  expect(store.acknowledge(owner, first.sessionId, id, 'accepted')).toBe('accepted');
  expect(() => store.acknowledge(owner, first.sessionId, id, 'rejected')).toThrow(
    'already settled',
  );
  expect(await store.poll(owner, first.sessionId)).toEqual([]);
  expect(store.status(owner, first.sessionId, id)).toBe('accepted');
  const expired = await store.send(owner, first.sessionId, {
    type: 'requestReview',
    title: 'Review tasks',
    operations: ['task.create'],
  });
  now = 101;
  expect(await store.poll(owner, first.sessionId)).toEqual([]);
  expect(store.status(owner, first.sessionId, expired)).toBe('expired');
  now = 201;
  expect(store.status(owner, first.sessionId, expired)).toBeUndefined();
  store.remove(owner, first.sessionId);
  await expect(store.poll(owner, first.sessionId)).rejects.toThrow('unavailable');
});

test('a late UI validation cannot overwrite a newer selection', async () => {
  const sessions = new Sessions();
  const owner = sessions.create({ principalId: 'owner', workspaceId: 'w' });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new UiSessionStore({
    isActive: (token) => !!sessions.get(token),
    validateIntent: async () => {},
    async validateContext(_, value) {
      if (value.selectedResources.includes('task:slow')) await waiting;
    },
  });
  const first = await store.register(owner, { selectedResources: [], observedRevisions: {} });
  const older = store.update(owner, first.sessionId, {
    selectedResources: ['task:slow'],
    observedRevisions: { 'task:slow': 0 },
  });
  await store.update(owner, first.sessionId, {
    selectedResources: ['task:new'],
    observedRevisions: { 'task:new': 0 },
  });
  release();
  await expect(older).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await store.capture(owner, first.sessionId)).selectedResources).toEqual(['task:new']);
});

test('a run sends intents only to the live UI session of its own principal, for resources it may read', async () => {
  let now = 0;
  const sessions = new Sessions(() => now);
  const owner = sessions.create({ principalId: 'owner', workspaceId: 'w' });
  const readable = new Set(['task:one', 'approval-request:a1']);
  const store = new UiSessionStore({
    now: () => now,
    isActive: (token) => !!sessions.get(token),
    validateContext: async () => {},
    async validateIntent(_, intent) {
      const named = 'resource' in intent ? [intent.resource] : (intent.resources ?? []);
      if (named.some((resource) => !readable.has(resource)))
        throw new ApplicationError('FORBIDDEN', 'Resource unavailable');
    },
    sessionTtlMs: 1000,
  });
  const { sessionId } = await store.register(owner, {
    selectedResources: ['task:one'],
    observedRevisions: { 'task:one': 0 },
  });
  const run = { principalId: 'owner', workspaceId: 'w', runId: 'r1' };
  const opened = await store.sendFromRun(run, sessionId, {
    type: 'openResource',
    resource: 'task:one',
  });
  const review = await store.sendFromRun(run, sessionId, {
    type: 'requestReview',
    title: 'Check the suggestion',
    operations: ['task.create'],
    resources: ['approval-request:a1'],
  });
  expect((await store.poll(owner, sessionId)).map((entry) => entry.id)).toEqual([opened, review]);

  const open = { type: 'openResource', resource: 'task:one' } as const;
  await expect(
    store.sendFromRun({ ...run, runId: undefined }, sessionId, open),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    store.sendFromRun({ ...run, principalId: 'someone-else' }, sessionId, open),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    store.sendFromRun({ ...run, workspaceId: 'other' }, sessionId, open),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    store.sendFromRun(run, sessionId, { type: 'openResource', resource: 'task:hidden' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    store.sendFromRun(run, sessionId, {
      type: 'requestReview',
      title: 'x',
      operations: [],
      resources: ['approval-request:hidden'],
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    store.sendFromRun({ ...run, signal: aborted.signal }, sessionId, open),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });

  now = 1001;
  await expect(store.sendFromRun(run, sessionId, open)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
