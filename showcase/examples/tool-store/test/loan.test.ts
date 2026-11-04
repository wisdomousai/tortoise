import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-loan-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++ids}`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}

const tool = (assetTag: string) => ({
  assetTag,
  description: 'Torque wrench 20-100 Nm',
  category: 'torque-tool',
  bin: 'A-03',
});

test('members list, filter, search and read loans; strangers cannot', async () => {
  const app = await open();
  await app.invokeRaw(
    { operation: 'tool.create', input: tool('TC-00601'), idempotencyKey: 't1' },
    owner,
  );
  await app.invokeRaw(
    { operation: 'tool.create', input: tool('TC-00602'), idempotencyKey: 't2' },
    owner,
  );
  const lend = (toolId: string, borrower: string, workOrder: string) =>
    app.invokeRaw(
      {
        operation: 'tool.check-out',
        input: { toolId, borrower, workOrder, dueAt: '2026-11-05T16:00:00Z' },
        idempotencyKey: `out-${toolId}`,
      },
      owner,
    );
  await lend('id-1', 'E004217', 'WO-100');
  await lend('id-2', 'E000042', 'WO-200');

  const byBorrower = await app.queryRaw(
    { operation: 'loan.list', input: { borrower: 'E000042' } },
    viewer,
  );
  expect(byBorrower.data).toMatchObject({ total: 1, items: [{ assetTag: 'TC-00602' }] });
  const byOrder = await app.queryRaw(
    { operation: 'loan.list', input: { search: 'wo-100' } },
    viewer,
  );
  expect(byOrder.data).toMatchObject({
    total: 1,
    items: [{ toolId: 'id-1', borrower: 'E004217' }],
  });
  const one = await app.queryRaw({ operation: 'loan.get', input: { id: 'id-3' } }, viewer);
  expect(one.data).toMatchObject({ id: 'id-3', assetTag: 'TC-00601', workOrder: 'WO-100' });

  await expect(app.queryRaw({ operation: 'loan.list', input: {} }, stranger)).rejects.toMatchObject(
    {
      code: 'FORBIDDEN',
    },
  );
  await expect(
    app.queryRaw({ operation: 'loan.get', input: { id: 'missing' } }, owner),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('only tool.check-out and tool.return write loans', async () => {
  const app = await open();
  for (const operation of ['loan.create', 'loan.update'])
    await expect(
      app.invokeRaw({ operation, input: { title: 'X' }, idempotencyKey: operation }, owner),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const none = await app.queryRaw({ operation: 'loan.list', input: {} }, owner);
  expect(none.data).toMatchObject({ total: 0 });
});
