import { expect, test } from 'bun:test';
import { createApplication, createMemoryStorage } from '@agent-native/runtime';
import { createDirectTransport } from '../../adapters/src/direct';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
} from '../../../examples/project-tasks/server';

const owner = { workspaceId: 'direct', principalId: 'owner' };
const viewer = { ...owner, principalId: 'viewer' };

async function projectApp() {
  let id = 0;
  const app = createApplication({
    modules: [projectTasksModule],
    handlers: createProjectTaskHandlers(),
    storage: createMemoryStorage(createProjectTaskState()),
    authorization: projectTaskPolicy,
    services: { newId: () => `id-${++id}` },
  });
  await app.invokeRaw(
    { operation: 'project.create', input: { name: 'Shared' }, idempotencyKey: 'p' },
    owner,
  );
  await app.invokeRaw(
    {
      operation: 'project.set-member',
      input: { id: 'id-1', principalId: 'viewer', role: 'viewer' },
      idempotencyKey: 'grant',
    },
    owner,
  );
  return app;
}

test('a per-request signal narrows the launcher cancellation, never replaces it', async () => {
  const app = await projectApp();
  const launcher = new AbortController();
  launcher.abort();
  const transport = createDirectTransport(app, { ...viewer, signal: launcher.signal });
  await expect(
    transport.query('task.list', {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  await expect(
    transport.command(
      'project.create',
      { name: 'Late' },
      { idempotencyKey: 'late', signal: new AbortController().signal },
    ),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
});

test('a subscription from a snapshot cursor resets when access changed in between', async () => {
  const app = await projectApp();
  const transport = createDirectTransport(app, viewer, { pollMs: 1 });
  const snapshot = await transport.query('task.list', {});
  // Revoked between the snapshot and the subscription.
  await app.invokeRaw(
    {
      operation: 'project.set-member',
      input: { id: 'id-1', principalId: 'viewer', role: null },
      idempotencyKey: 'revoke',
    },
    owner,
  );
  const controller = new AbortController();
  for await (const batch of transport.events(snapshot.cursor, controller.signal)) {
    expect(batch.reset).toBe(true);
    expect(batch.authorizationRevision).toBeGreaterThan(snapshot.authorizationRevision);
    controller.abort();
  }
}, 2_000);

test('a subscription from a current snapshot cursor resumes without a reset', async () => {
  const app = await projectApp();
  const transport = createDirectTransport(app, viewer, { pollMs: 1 });
  const snapshot = await transport.query('task.list', {});
  await app.invokeRaw(
    {
      operation: 'task.create',
      input: { projectId: 'id-1', title: 'New' },
      idempotencyKey: 'task',
    },
    owner,
  );
  const controller = new AbortController();
  for await (const batch of transport.events(snapshot.cursor, controller.signal)) {
    expect(batch.reset).toBe(false);
    expect(batch.changes.map((change) => change.resource)).toContain('task:id-2');
    controller.abort();
  }
}, 2_000);
