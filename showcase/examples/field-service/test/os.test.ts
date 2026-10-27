import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import fieldService from '../application';
import { workOrderSummary } from '../ui/work-orders/summary';

const scheme = 'dev.example.field-service';
const directories: string[] = [];
afterAll(() => Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))));

/** A started host and calls as the owner's session, closed after `run`. */
async function withHost(
  run: (
    call: (path: string, body?: unknown) => Promise<any>,
    session: { url: string; token: string },
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'field-service-os-'));
  directories.push(directory);
  const host = await startHost(fieldService, {
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

test('a task link opens its work order; a text file prefills a task that is added once', () =>
  withHost(async (call) => {
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const workOrder = (await command('work-order.create', { name: 'Boiler B1 service' }, 'p-1'))
      .result;
    const task = (await command('task.create', { workOrderId: workOrder.id, title: 'Plan' }, 't-1'))
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
        request: {
          kind: 'file',
          name: 'Inspection checklist.md',
          text: '# Checklist\n\nCheck the flue.',
        },
      }),
    ).toEqual({ status: 'delivered', handler: 'task.from-text' });
    const [prefill] = await call('ui/deliveries');
    expect(prefill.delivery).toEqual({
      type: 'prepare',
      operation: 'task.create',
      input: { title: 'Inspection checklist', description: '# Checklist\n\nCheck the flue.' },
      provenance: { kind: 'file', handler: 'task.from-text', label: 'Inspection checklist.md' },
    });
    // Delivering the prefill committed nothing: the work order still has one task.
    expect(
      (await call(`queries/task.list`, { input: { workOrderId: workOrder.id } })).data.count,
    ).toBe(1);

    // The person adds it; a retry with the form's key adds no second task.
    const input = { workOrderId: workOrder.id, ...prefill.delivery.input };
    await command('task.create', input, `prefill-${prefill.id}`);
    await command('task.create', input, `prefill-${prefill.id}`);
    expect(
      (await call(`queries/task.list`, { input: { workOrderId: workOrder.id } })).data.count,
    ).toBe(2);
  }));

test('an image is staged, prefills a task, and is attached only when the person adds it', () =>
  withHost(async (call, session) => {
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const workOrder = (await command('work-order.create', { name: 'Pump P-101 repair' }, 'p-1'))
      .result;
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
        request: { kind: 'file', name: 'Nameplate.png', mediaType: 'image/png', blob },
      }),
    ).toEqual({ status: 'delivered', handler: 'task.from-attachment' });
    const [prefill] = await call('ui/deliveries');
    expect(prefill.delivery).toMatchObject({
      type: 'prepare',
      input: { title: 'Nameplate', attachment: blob },
      provenance: { kind: 'file', handler: 'task.from-attachment', label: 'Nameplate.png' },
    });
    // Staged, not attached: no task references it, so nobody may read it yet.
    const unread = await fetch(`${session.url}/api/v1/blobs/${blob.digest}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(unread.ok).toBe(false);

    // A reference to bytes this session never uploaded is refused like any unknown blob.
    const forged = { ...blob, digest: `sha256:${'0'.repeat(64)}` };
    expect(
      (
        await command(
          'task.create',
          { workOrderId: workOrder.id, title: 'x', attachment: forged },
          'f',
        )
      ).error,
    ).toBeDefined();

    const input = { workOrderId: workOrder.id, ...prefill.delivery.input };
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
      body: new URLSearchParams({ title: 'Service manual', url: 'https://example.com/manual' }),
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
      input: { description: 'https://example.com/manual' },
      provenance: { kind: 'share', handler: 'task.from-shared-link' },
    });
  }));

test('a reminder waits for the desktop, shows with Mark done, and the reply sets the status once', () =>
  withHost(async (call) => {
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const workOrder = (await command('work-order.create', { name: 'Boiler B1 service' }, 'p-1'))
      .result;
    const task = (await command('task.create', { workOrderId: workOrder.id, title: 'Plan' }, 't-1'))
      .result;
    expect((await command('task.remind', { id: task.id }, 'r-1')).result.reminder).toBe('pending');

    // Electron main attaches by polling for instructions as the owner's session.
    const relayed = await call('shell/actions?platform=macos');
    expect(relayed.instruction).toMatchObject({
      kind: 'notify',
      action: 'task.reminder',
      category: 'task-reminder',
      title: 'Plan',
      buttons: [{ id: 'done', title: 'Mark done', handler: 'task.reminder-reply' }],
    });
    await call(`shell/actions/${relayed.id}/result`, { ok: true });
    const get = async () => (await call('queries/task.get', { input: { id: task.id } })).data;
    for (let tries = 0; (await get()).reminder !== 'accepted' && tries < 100; tries += 1)
      await Bun.sleep(20);
    expect(await get()).toMatchObject({ reminder: 'accepted', status: 'todo' });

    const [button] = relayed.instruction.buttons;
    const reply = () =>
      call('shell/requests', {
        platform: 'macos',
        request: { kind: 'reply', handler: button.handler, nonce: button.nonce, action: 'done' },
      });
    expect(await reply()).toEqual({ status: 'consumed', handler: 'task.reminder-reply' });
    const done = await get();
    expect(done.status).toBe('done');
    // The OS may report the choice twice; the nonce works once, so nothing changes again.
    await reply();
    expect((await get()).revision).toBe(done.revision);
  }));

test('a work order site opens on a map, and its summary is shared as text', () =>
  withHost(async (call) => {
    const command = (operation: string, input: unknown, idempotencyKey: string) =>
      call(`commands/${operation}`, { input, idempotencyKey });
    const workOrder = (
      await command(
        'work-order.create',
        { name: 'Chiller C2 service', site: 'Hafenstrasse 12, Basel' },
        'w-1',
      )
    ).result;
    expect(workOrder.site).toBe('Hafenstrasse 12, Basel');
    const tasks = [
      (
        await command(
          'task.create',
          { workOrderId: workOrder.id, title: 'Check refrigerant' },
          't-1',
        )
      ).result,
      (await command('task.create', { workOrderId: workOrder.id, title: 'Clean condenser' }, 't-2'))
        .result,
    ];
    await command('task.set-status', { id: tasks[1].id, status: 'done' }, 's-1');

    // With no shell attached, the page gets the instruction and opens the URL itself.
    expect(
      await call('shell/actions', {
        action: 'work-order.site-map',
        params: { query: workOrder.site },
      }),
    ).toEqual({
      status: 'instruction',
      instruction: {
        kind: 'open',
        action: 'work-order.site-map',
        url: 'https://www.openstreetmap.org/search?query=Hafenstrasse+12%2C+Basel',
      },
    });
    // Only the declared parameter reaches the URL.
    expect(
      await call('shell/actions', {
        action: 'work-order.site-map',
        params: { query: workOrder.site, zoom: '19' },
      }),
    ).toMatchObject({ status: 'refused', reason: 'invalid' });

    const listed = (await call('queries/task.list', { input: { workOrderId: workOrder.id } })).data;
    const text = workOrderSummary(workOrder, listed.items);
    expect(text).toBe(
      'Chiller C2 service\nSite: Hafenstrasse 12, Basel\nOpen tasks:\n- Check refrigerant',
    );
    expect(
      await call('shell/actions', {
        action: 'work-order.share',
        params: { title: workOrder.name, text },
      }),
    ).toEqual({
      status: 'instruction',
      instruction: { kind: 'share', action: 'work-order.share', title: workOrder.name, text },
    });
    // The summary action shares text; a URL is refused.
    expect(
      await call('shell/actions', {
        action: 'work-order.share',
        params: { url: 'https://example.com/' },
      }),
    ).toMatchObject({ status: 'refused', reason: 'invalid' });
  }));
