import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import projectTasks from '../application';

const scheme = 'dev.example.project-tasks';
const directories: string[] = [];
afterAll(() => Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))));

/** A started host and calls as the owner's session, closed after `run`. */
async function withHost(
  run: (
    call: (path: string, body?: unknown) => Promise<any>,
    session: { url: string; token: string },
  ) => Promise<void>,
) {
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
    await run(call, { url: host.url, token });
  } finally {
    await host.close();
  }
}

test('a task link opens its project; a text file prefills a task that is added once', () =>
  withHost(async (call) => {
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
  }));

test('an image is staged, prefills a task, and is attached only when the person adds it', () =>
  withHost(async (call, session) => {
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const project = (await command('project.create', { name: 'Expenses' }, 'p-1')).result;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // The shell uploads the file as its session before submitting the request.
    const uploaded = await fetch(`${session.url}/api/v1/blobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'image/png' },
      body: bytes,
    });
    expect(uploaded.status).toBe(201);
    const blob = await uploaded.json();

    expect(
      await call('shell/requests', {
        platform: 'web',
        request: { kind: 'file', name: 'Receipt.png', mediaType: 'image/png', blob },
      }),
    ).toEqual({ status: 'delivered', handler: 'task.from-attachment' });
    const [prefill] = await call('ui/deliveries');
    expect(prefill.delivery).toMatchObject({
      type: 'prepare',
      input: { title: 'Receipt', attachment: blob },
      provenance: { kind: 'file', handler: 'task.from-attachment', label: 'Receipt.png' },
    });
    // Staged, not attached: no task references it, so nobody may read it yet.
    const unread = await fetch(`${session.url}/api/v1/blobs/${blob.digest}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(unread.ok).toBe(false);

    // A reference to bytes this session never uploaded is refused like any unknown blob.
    const forged = { ...blob, digest: `sha256:${'0'.repeat(64)}` };
    expect(
      (await command('task.create', { projectId: project.id, title: 'x', attachment: forged }, 'f'))
        .error,
    ).toBeDefined();

    const input = { projectId: project.id, ...prefill.delivery.input };
    const task = (await command('task.create', input, `prefill-${prefill.id}`)).result;
    expect(task.attachment).toEqual(blob);
    const read = await fetch(`${session.url}/api/v1/blobs/${blob.digest}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
  }));

test('a link shared to the web app is held, then prefills a task for the session that claims it', () =>
  withHost(async (call, session) => {
    const posted = await fetch(`${session.url}/os/share`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
      body: new URLSearchParams({ title: 'Spec', url: 'https://example.com/spec' }),
    });
    expect(posted.status).toBe(303);
    const code = new URL(posted.headers.get('location')!, session.url).searchParams.get('os-share');
    expect(
      await call('shell/requests', { platform: 'web', request: { kind: 'claim', code } }),
    ).toEqual({ status: 'delivered', handler: 'task.from-shared-link' });
    const [prefill] = await call('ui/deliveries');
    expect(prefill.delivery).toEqual({
      type: 'prepare',
      operation: 'task.create',
      input: { description: 'https://example.com/spec' },
      provenance: { kind: 'share', handler: 'task.from-shared-link' },
    });
  }));
