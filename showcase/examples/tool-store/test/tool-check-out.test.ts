import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-tool-check-out-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `id-${++ids}`, now: () => 2_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const app = instance.application;
  // The first record of every test: tool `id-1`, available, at revision 1.
  await app.invokeRaw(
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
    owner,
  );
  return app;
}

const checkOut = {
  toolId: 'id-1',
  borrower: 'E004217',
  workOrder: 'WO-100',
  dueAt: '2026-11-05T16:00:00Z',
};

const statusOf = async (app: Awaited<ReturnType<typeof open>>) =>
  (await app.queryRaw({ operation: 'tool.get', input: { id: 'id-1' } }, owner)).data as {
    status: string;
  };
const loanTotal = async (app: Awaited<ReturnType<typeof open>>) =>
  (await app.queryRaw({ operation: 'loan.list', input: {} }, owner)).data as { total: number };

test('an attendant lends an available tool: an open loan and a checked-out tool', async () => {
  const app = await open();
  const receipt = await app.invokeRaw(
    {
      operation: 'tool.check-out',
      input: { ...checkOut, workOrder: ' WO-100 ' },
      idempotencyKey: 'out',
    },
    owner,
  );
  expect(receipt.result).toEqual({
    id: 'id-2',
    toolId: 'id-1',
    assetTag: 'TC-00601',
    borrower: 'E004217',
    workOrder: 'WO-100',
    dueAt: '2026-11-05T16:00:00Z',
    checkedOutBy: 'owner',
    checkedOutAt: 2_000,
  });
  expect(await statusOf(app)).toMatchObject({ status: 'checked-out' });
  expect(await loanTotal(app)).toMatchObject({ total: 1 });
});

test('a viewer is refused and nothing changes', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      { operation: 'tool.check-out', input: checkOut, idempotencyKey: 'viewer' },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await statusOf(app)).toMatchObject({ status: 'available' });
  expect(await loanTotal(app)).toMatchObject({ total: 0 });
});

test('a stale tool revision is refused and nothing changes', async () => {
  const app = await open();
  // The tool is at revision 1 after create; this edit moves it to 2.
  await app.invokeRaw(
    { operation: 'tool.update', input: { id: 'id-1', bin: 'A-04' }, idempotencyKey: 'edit' },
    owner,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.check-out',
        input: checkOut,
        idempotencyKey: 'stale',
        expectedRevisions: { 'tool:id-1': 1 },
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await statusOf(app)).toMatchObject({ status: 'available' });
  expect(await loanTotal(app)).toMatchObject({ total: 0 });
  // The same call at the current revision commits.
  await app.invokeRaw(
    {
      operation: 'tool.check-out',
      input: checkOut,
      idempotencyKey: 'current',
      expectedRevisions: { 'tool:id-1': 2 },
    },
    owner,
  );
  expect(await statusOf(app)).toMatchObject({ status: 'checked-out' });
});

test('a repeated idempotency key returns the same receipt and lends once', async () => {
  const app = await open();
  const request = { operation: 'tool.check-out', input: checkOut, idempotencyKey: 'retry' };
  const first = await app.invokeRaw(request, owner);
  const again = await app.invokeRaw(request, owner);
  expect(again).toEqual(first);
  expect(await loanTotal(app)).toMatchObject({ total: 1 });
});

test('a second check-out of the same tool is refused with CONFLICT', async () => {
  const app = await open();
  await app.invokeRaw(
    { operation: 'tool.check-out', input: checkOut, idempotencyKey: 'first' },
    owner,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.check-out',
        input: { ...checkOut, borrower: 'E000042', workOrder: 'WO-200' },
        idempotencyKey: 'second',
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const loans = await app.queryRaw({ operation: 'loan.list', input: {} }, owner);
  expect(loans.data).toMatchObject({ total: 1, items: [{ borrower: 'E004217' }] });
});

test('a tool that is not available, a missing tool and bad input are refused', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.check-out',
        input: { ...checkOut, toolId: 'missing' },
        idempotencyKey: 'a',
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  for (const [key, input] of Object.entries({
    badBorrower: { borrower: 'E4217' },
    blankOrder: { workOrder: '   ' },
    badDue: { dueAt: 'tomorrow' },
  }))
    await expect(
      app.invokeRaw(
        { operation: 'tool.check-out', input: { ...checkOut, ...input }, idempotencyKey: key },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await loanTotal(app)).toMatchObject({ total: 0 });
});
