import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import projectTasks from '../application';

const scheme = 'dev.example.project-tasks';
const directories: string[] = [];
afterAll(() => Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))));

test('a task link opens its project; a text file prefills a task that is added once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'project-tasks-os-'));
  directories.push(directory);
  const host = await startHost(projectTasks, {
    workspacePath: directory,
    integration: false,
    settings: { 'os-scheme': scheme },
  });
  try {
    const { token } = host.sessions.create({ workspaceId: 'local', principalId: 'owner' });
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`${host.url}/api/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return response.json();
    };
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const project = (await command('project.create', { name: 'Launch' }, 'p-1')).result;
    const task = (await command('task.create', { projectId: project.id, title: 'Plan' }, 't-1'))
      .result;

    expect(
      await call('shell/requests', {
        platform: 'macos',
        request: { kind: 'url', url: `${scheme}://tasks/${task.id}` },
      }),
    ).toEqual({ status: 'delivered', handler: 'task.open' });
    const [opened] = await call('ui/deliveries');
    expect(opened.delivery).toMatchObject({ type: 'openResource', resource: `task:${task.id}` });
    await call(`ui/deliveries/${opened.id}/ack`, { status: 'accepted' });

    expect(
      await call('shell/requests', {
        platform: 'macos',
        request: { kind: 'file', name: 'Release notes.md', text: '# Draft\n\nShip it.' },
      }),
    ).toEqual({ status: 'delivered', handler: 'task.from-text' });
    const [prefill] = await call('ui/deliveries');
    expect(prefill.delivery).toEqual({
      type: 'prepare',
      operation: 'task.create',
      input: { title: 'Release notes', description: '# Draft\n\nShip it.' },
      provenance: { kind: 'file', handler: 'task.from-text', label: 'Release notes.md' },
    });
    // Delivering the prefill committed nothing: the project still has one task.
    expect((await call(`queries/task.list`, { input: { projectId: project.id } })).data.count).toBe(
      1,
    );

    // The person adds it; a retry with the form's key adds no second task.
    const input = { projectId: project.id, ...prefill.delivery.input };
    await command('task.create', input, `prefill-${prefill.id}`);
    await command('task.create', input, `prefill-${prefill.id}`);
    expect((await call(`queries/task.list`, { input: { projectId: project.id } })).data.count).toBe(
      2,
    );
  } finally {
    await host.close();
  }
});
