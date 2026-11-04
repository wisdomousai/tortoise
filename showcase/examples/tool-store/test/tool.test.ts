import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { createToolStoreApplication } from '../application';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-tool-'));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { viewer: 'viewer', clerk: 'attendant' },
      services: { newId: () => `tool-${++ids}`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return instance.application;
}

const wrench = {
  assetTag: 'TC-00601',
  description: 'Torque wrench 20-100 Nm',
  category: 'torque-tool',
  bin: 'A-03',
  calibrationDue: '2027-03-01',
};

test('attendants add and update tools; members list, filter and search them', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: 'tool.create', input: wrench, idempotencyKey: 'create-1' },
    localUser,
  );
  expect(created.result).toMatchObject({
    id: 'tool-1',
    ...wrench,
    status: 'available',
    createdBy: 'local-user',
    createdAt: 1_000,
  });
  await app.invokeRaw(
    {
      operation: 'tool.create',
      input: {
        assetTag: 'TC-00602',
        description: 'Crimper 0.5-6 mm2',
        category: 'crimper',
        bin: 'B-01',
      },
      idempotencyKey: 'create-2',
    },
    localUser,
  );
  const updated = await app.invokeRaw(
    {
      operation: 'tool.update',
      input: { id: 'tool-1', bin: ' A-04 ', description: ' Torque wrench 10-50 Nm ' },
      idempotencyKey: 'update-1',
    },
    localUser,
  );
  // The update keeps the fields it leaves out, trims the ones it changes and never touches the tag.
  expect(updated.result).toMatchObject({
    assetTag: 'TC-00601',
    description: 'Torque wrench 10-50 Nm',
    bin: 'A-04',
    category: 'torque-tool',
    calibrationDue: '2027-03-01',
    status: 'available',
  });
  const byCategory = await app.queryRaw(
    { operation: 'tool.list', input: { category: 'crimper' } },
    viewer,
  );
  expect(byCategory.data).toMatchObject({ total: 1, items: [{ assetTag: 'TC-00602' }] });
  const byStatus = await app.queryRaw(
    { operation: 'tool.list', input: { status: 'missing' } },
    viewer,
  );
  expect(byStatus.data).toMatchObject({ total: 0, items: [] });
  const byTag = await app.queryRaw(
    { operation: 'tool.list', input: { search: 'tc-00601' } },
    viewer,
  );
  expect(byTag.data).toMatchObject({ total: 1, items: [{ id: 'tool-1' }] });
  const byDescription = await app.queryRaw(
    { operation: 'tool.list', input: { search: 'CRIMPER' } },
    viewer,
  );
  expect(byDescription.data).toMatchObject({ total: 1, items: [{ id: 'tool-2' }] });
});

test('a duplicate asset tag is refused and the first tool stays', async () => {
  const app = await open();
  await app.invokeRaw({ operation: 'tool.create', input: wrench, idempotencyKey: 'a' }, localUser);
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.create',
        input: { ...wrench, description: 'Copy', category: 'gauge', bin: 'A-04' },
        idempotencyKey: 'b',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const all = await app.queryRaw({ operation: 'tool.list', input: {} }, localUser);
  expect(all.data).toMatchObject({
    total: 1,
    items: [{ id: 'tool-1', description: wrench.description }],
  });
});

test('input that breaks the record shape is refused', async () => {
  const app = await open();
  const create = (input: Record<string, unknown>, key: string) =>
    app.invokeRaw(
      { operation: 'tool.create', input: { ...wrench, ...input }, idempotencyKey: key },
      localUser,
    );
  await expect(create({ assetTag: 'TC-601' }, 'k1')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(create({ category: 'hammer' }, 'k2')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(create({ calibrationDue: '01/03/2027' }, 'k3')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(create({ calibrationDue: '2027-02-30' }, 'k4')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  // Status is not an input of create or update.
  await expect(create({ status: 'retired' }, 'k5')).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  const none = await app.queryRaw({ operation: 'tool.list', input: {} }, localUser);
  expect(none.data).toMatchObject({ total: 0 });
});

test('a tool needs no calibration date', async () => {
  const app = await open();
  const { calibrationDue: _, ...plain } = wrench;
  const created = await app.invokeRaw(
    {
      operation: 'tool.create',
      input: { ...plain, category: 'hand-tool' },
      idempotencyKey: 'plain',
    },
    localUser,
  );
  expect(created.result).not.toHaveProperty('calibrationDue');
});

test('viewers cannot write, strangers cannot read, and a missing tool is NOT_FOUND', async () => {
  const app = await open();
  await app.invokeRaw(
    { operation: 'tool.create', input: wrench, idempotencyKey: 'seed' },
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.create',
        input: { ...wrench, assetTag: 'TC-00603' },
        idempotencyKey: 'viewer',
      },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.invokeRaw(
      {
        operation: 'tool.update',
        input: { id: 'tool-1', bin: 'Z-99' },
        idempotencyKey: 'viewer-2',
      },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(app.queryRaw({ operation: 'tool.list', input: {} }, stranger)).rejects.toMatchObject(
    { code: 'FORBIDDEN' },
  );
  await expect(
    app.queryRaw({ operation: 'tool.get', input: { id: 'missing' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    app.invokeRaw(
      { operation: 'tool.update', input: { id: 'missing', bin: 'A-01' }, idempotencyKey: 'gone' },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('a member with the attendant role writes', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: 'tool.create', input: wrench, idempotencyKey: 'clerk' },
    clerk,
  );
  expect(created.result).toMatchObject({ assetTag: 'TC-00601', createdBy: 'clerk' });
});
