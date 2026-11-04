import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const application = () =>
  createToolStoreApplication({
    members: { viewer: 'viewer', clerk: 'attendant' },
    services: { newId: () => `id-${crypto.randomUUID()}`, now: () => 2_000 },
  });

/** A workspace with tool `toolId`, available and at revision 1. */
async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-tool-retire-'));
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  const instance = await openEmbeddedInstance(application(), { workspacePath });
  cleanup.push(() => instance.close());
  const app = instance.application;
  const created = await app.invokeRaw(
    {
      operation: 'tool.create',
      input: {
        assetTag: 'TC-00601',
        description: 'Torque wrench 20-100 Nm',
        category: 'torque-tool',
        bin: 'A-03',
      },
      idempotencyKey: 'seed',
    },
    localUser,
  );
  const toolId = (created.result as { id: string }).id;
  const invoke = (operation: string, input: unknown, idempotencyKey: string, who = localUser) =>
    app.invokeRaw({ operation, input, idempotencyKey }, who);
  const lend = () =>
    invoke(
      'tool.check-out',
      { toolId, borrower: 'E004217', workOrder: 'WO-100', dueAt: '2026-11-05T16:00:00Z' },
      `out-${crypto.randomUUID()}`,
    );
  const status = async () =>
    (
      (await app.queryRaw({ operation: 'tool.get', input: { id: toolId } }, localUser)).data as {
        status: string;
      }
    ).status;
  return { instance, workspacePath, app, toolId, invoke, lend, status };
}

test('an attendant retires a tool in repair, and a reopened instance reads it retired', async () => {
  const { instance, workspacePath, toolId, invoke, lend } = await open();
  await lend();
  await invoke('tool.return', { toolId, condition: 'damaged', note: 'cracked' }, 'in');
  const receipt = await invoke('tool.retire', { toolId }, 'retire', clerk);
  expect(receipt.result).toMatchObject({ id: toolId, assetTag: 'TC-00601', status: 'retired' });
  expect(receipt.revisions).toHaveProperty(`tool:${toolId}`);
  await instance.close();
  const reopened = await openEmbeddedInstance(application(), { workspacePath });
  cleanup.push(() => reopened.close());
  const read = await reopened.application.queryRaw(
    { operation: 'tool.get', input: { id: toolId } },
    viewer,
  );
  expect(read.data).toMatchObject({ status: 'retired' });
});

test('an attendant retires an available tool, and the loans stay as they are', async () => {
  const { app, toolId, invoke, lend, status } = await open();
  await lend();
  await invoke('tool.return', { toolId, condition: 'ok' }, 'in');
  await invoke('tool.retire', { toolId }, 'retire');
  expect(await status()).toBe('retired');
  const loans = await app.queryRaw({ operation: 'loan.list', input: { toolId } }, localUser);
  expect(loans.data).toMatchObject({ total: 1, items: [{ condition: 'ok' }] });
});

test('a viewer is refused and the tool keeps its status', async () => {
  const { toolId, invoke, status } = await open();
  await expect(invoke('tool.retire', { toolId }, 'viewer', viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(await status()).toBe('available');
});

test('a stale tool revision is refused', async () => {
  const { app, toolId, status } = await open();
  await app.invokeRaw(
    { operation: 'tool.update', input: { id: toolId, bin: 'A-04' }, idempotencyKey: 'move' },
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.retire',
        input: { toolId },
        idempotencyKey: 'stale',
        expectedRevisions: { [`tool:${toolId}`]: 1 },
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await status()).toBe('available');
});

test('a repeated idempotency key returns the same receipt; a second retirement conflicts', async () => {
  const { toolId, invoke } = await open();
  const first = await invoke('tool.retire', { toolId }, 'retire');
  expect(await invoke('tool.retire', { toolId }, 'retire')).toEqual(first);
  await expect(invoke('tool.retire', { toolId }, 'again')).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'Tool is already retired',
  });
});

test('a lent tool is refused until it is returned, and an unknown tool is not found', async () => {
  const { toolId, invoke, lend, status } = await open();
  await lend();
  await expect(invoke('tool.retire', { toolId }, 'lent')).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(await status()).toBe('checked-out');
  await expect(invoke('tool.retire', { toolId: 'missing' }, 'gone')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(invoke('tool.retire', {}, 'bad')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('approval to retire a lent, retired or unknown tool is refused before anyone is asked', async () => {
  const { app, toolId, invoke, lend } = await open();
  const request = (id: string, key: string) =>
    invoke(
      'approval.request',
      { operation: 'tool.retire', input: { toolId: id }, rationale: 'Worn out.' },
      key,
    );
  await lend();
  await expect(request(toolId, 'lent')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(request('missing', 'gone')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await invoke('tool.return', { toolId, condition: 'damaged' }, 'in');
  await expect(request(toolId, 'in-repair')).resolves.toMatchObject({
    result: { operation: 'tool.retire', status: 'pending' },
  });
  await invoke('tool.retire', { toolId }, 'retire');
  await expect(request(toolId, 'retired')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  // Approval requests name only tool.retire.
  await expect(
    invoke(
      'approval.request',
      { operation: 'tool.update', input: { id: toolId, bin: 'A-04' }, rationale: 'Move it.' },
      'update',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const pending = await app.queryRaw(
    { operation: 'approval.list', input: { status: 'pending' } },
    localUser,
  );
  expect(pending.data).toMatchObject({ total: 1 });
});
