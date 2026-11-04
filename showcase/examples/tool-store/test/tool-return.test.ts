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

let clock = 2_000;
/** A tool `id-1` lent to E004217: the tool is at revision 2, the loan `id-2` at revision 1. */
async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-tool-return-'));
  let ids = 0;
  clock = 2_000;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer', clerk: 'attendant' },
      services: { newId: () => `id-${++ids}`, now: () => clock },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const app = instance.application;
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
    localUser,
  );
  await app.invokeRaw(
    {
      operation: 'tool.check-out',
      input: {
        toolId: 'id-1',
        borrower: 'E004217',
        workOrder: 'WO-100',
        dueAt: '2026-11-05T16:00:00Z',
      },
      idempotencyKey: 'out',
    },
    localUser,
  );
  return app;
}
type App = Awaited<ReturnType<typeof open>>;

const statusOf = async (app: App) =>
  (await app.queryRaw({ operation: 'tool.get', input: { id: 'id-1' } }, localUser)).data as {
    status: string;
  };
const loan = async (app: App) =>
  (await app.queryRaw({ operation: 'loan.get', input: { id: 'id-2' } }, localUser)).data;

test('an ok return closes the loan and makes the tool available', async () => {
  const app = await open();
  clock = 3_000;
  const receipt = await app.invokeRaw(
    { operation: 'tool.return', input: { toolId: 'id-1', condition: 'ok' }, idempotencyKey: 'in' },
    clerk,
  );
  expect(receipt.result).toMatchObject({
    id: 'id-2',
    condition: 'ok',
    returnedAt: 3_000,
    returnedBy: 'clerk',
    checkedOutBy: 'local-user',
  });
  expect(receipt.result).not.toHaveProperty('note');
  expect(await statusOf(app)).toMatchObject({ status: 'available' });
  expect(await loan(app)).toMatchObject({ condition: 'ok', returnedAt: 3_000 });
});

test('a damaged return keeps the note and sends the tool to repair', async () => {
  const app = await open();
  await app.invokeRaw(
    {
      operation: 'tool.return',
      input: { toolId: 'id-1', condition: 'damaged', note: ' ratchet slips ' },
      idempotencyKey: 'in',
    },
    localUser,
  );
  expect(await statusOf(app)).toMatchObject({ status: 'in-repair' });
  expect(await loan(app)).toMatchObject({ condition: 'damaged', note: 'ratchet slips' });
});

test('a viewer is refused and the loan stays open', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      { operation: 'tool.return', input: { toolId: 'id-1', condition: 'ok' }, idempotencyKey: 'v' },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await statusOf(app)).toMatchObject({ status: 'checked-out' });
  expect(await loan(app)).not.toHaveProperty('returnedAt');
});

test('a stale tool revision is refused and the loan stays open', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.return',
        input: { toolId: 'id-1', condition: 'ok' },
        idempotencyKey: 'stale',
        expectedRevisions: { 'tool:id-1': 1 },
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await statusOf(app)).toMatchObject({ status: 'checked-out' });
  expect(await loan(app)).not.toHaveProperty('returnedAt');
});

test('a repeated idempotency key returns the same receipt and closes the loan once', async () => {
  const app = await open();
  const request = {
    operation: 'tool.return',
    input: { toolId: 'id-1', condition: 'damaged' },
    idempotencyKey: 'retry',
  };
  const first = await app.invokeRaw(request, localUser);
  clock = 9_000;
  expect(await app.invokeRaw(request, localUser)).toEqual(first);
  expect(await loan(app)).toMatchObject({ returnedAt: 2_000 });
});

test('a tool that is not checked out cannot be returned', async () => {
  const app = await open();
  const ok = { toolId: 'id-1', condition: 'ok' };
  await app.invokeRaw({ operation: 'tool.return', input: ok, idempotencyKey: 'first' }, localUser);
  await expect(
    app.invokeRaw({ operation: 'tool.return', input: ok, idempotencyKey: 'again' }, localUser),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    app.invokeRaw(
      { operation: 'tool.return', input: { ...ok, toolId: 'missing' }, idempotencyKey: 'gone' },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    app.invokeRaw(
      { operation: 'tool.return', input: { ...ok, condition: 'broken' }, idempotencyKey: 'bad' },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('a returned tool can be lent again, to a new loan', async () => {
  const app = await open();
  await app.invokeRaw(
    { operation: 'tool.return', input: { toolId: 'id-1', condition: 'ok' }, idempotencyKey: 'in' },
    localUser,
  );
  await app.invokeRaw(
    {
      operation: 'tool.check-out',
      input: {
        toolId: 'id-1',
        borrower: 'E000042',
        workOrder: 'WO-200',
        dueAt: '2026-11-06T09:00:00+01:00',
      },
      idempotencyKey: 'out-2',
    },
    localUser,
  );
  const open_ = await app.queryRaw(
    { operation: 'loan.list', input: { toolId: 'id-1' } },
    localUser,
  );
  expect(open_.data).toMatchObject({ total: 2 });
  // The first loan is untouched; the return closes only the tool's open loan.
  await app.invokeRaw(
    {
      operation: 'tool.return',
      input: { toolId: 'id-1', condition: 'ok' },
      idempotencyKey: 'in-2',
    },
    localUser,
  );
  expect(await loan(app)).toMatchObject({ borrower: 'E004217', returnedAt: 2_000 });
});
