import { expect, test } from 'bun:test';
import { owner, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('customer');
const nordhafen = { account: 'U1042', name: 'Stadtwerke Nordhafen', phone: '+49 40 5550 1042' };

test('the desk adds and changes utilities; members list and search them', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'create-1' },
    owner,
  );
  expect(created.result).toEqual({
    id: 'id-1',
    ...nordhafen,
    createdBy: 'owner',
    createdAt: 1_000,
  });
  await app.invokeRaw(
    {
      operation: 'customer.update',
      input: { id: 'id-1', phone: '+49 40 5550 2000' },
      idempotencyKey: 'update-1',
    },
    owner,
  );
  const found = await app.queryRaw(
    { operation: 'customer.list', input: { search: 'nordhafen' } },
    viewer,
  );
  expect(found.data).toMatchObject({
    total: 1,
    items: [{ account: 'U1042', phone: '+49 40 5550 2000' }],
  });
  const byAccount = await app.queryRaw(
    { operation: 'customer.list', input: { search: 'u10' } },
    viewer,
  );
  expect(byAccount.data).toMatchObject({ total: 1 });
});

test('an account is U and four digits, and one utility holds it', async () => {
  const app = await open();
  await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'a' },
    owner,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.create',
        input: { ...nordhafen, name: 'Copy' },
        idempotencyKey: 'b',
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.create',
        input: { ...nordhafen, account: 'U104' },
        idempotencyKey: 'c',
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('a repeated key returns the first receipt and a stale revision is refused', async () => {
  const app = await open();
  const first = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'once' },
    owner,
  );
  const again = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'once' },
    owner,
  );
  expect(again.result).toEqual(first.result);
  expect((await app.queryRaw({ operation: 'customer.list', input: {} }, owner)).data).toMatchObject(
    { total: 1 },
  );
  const revision = first.revisions['customer:id-1']!;
  await app.invokeRaw(
    {
      operation: 'customer.update',
      input: { id: 'id-1', name: 'Nordhafen Netz' },
      idempotencyKey: 'rename',
      expectedRevisions: { 'customer:id-1': revision },
    },
    owner,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.update',
        input: { id: 'id-1', name: 'Stale' },
        idempotencyKey: 'stale',
        expectedRevisions: { 'customer:id-1': revision },
      },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('viewers cannot write, strangers cannot read, and a missing utility is NOT_FOUND', async () => {
  const app = await open();
  await expect(
    app.invokeRaw(
      { operation: 'customer.create', input: nordhafen, idempotencyKey: 'viewer' },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'customer.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'customer.get', input: { id: 'missing' } }, owner),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
