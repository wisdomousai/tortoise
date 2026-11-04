import { expect, test } from 'bun:test';
import { localUser, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('customer');
const nordhafen = { account: 'U1042', name: 'Stadtwerke Nordhafen', phone: '+49 40 5550 1042' };

test('the desk adds and changes utilities; members list and search them', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'create-1' },
    localUser,
  );
  expect(created.result).toEqual({
    id: 'id-1',
    ...nordhafen,
    createdBy: 'local-user',
    createdAt: 1_000,
  });
  await app.invokeRaw(
    {
      operation: 'customer.update',
      input: { id: 'id-1', phone: '+49 40 5550 2000' },
      idempotencyKey: 'update-1',
    },
    localUser,
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
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.create',
        input: { ...nordhafen, name: 'Copy' },
        idempotencyKey: 'b',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.create',
        input: { ...nordhafen, account: 'U104' },
        idempotencyKey: 'c',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('a repeated key returns the first command result and a stale revision is refused', async () => {
  const app = await open();
  const first = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'once' },
    localUser,
  );
  const again = await app.invokeRaw(
    { operation: 'customer.create', input: nordhafen, idempotencyKey: 'once' },
    localUser,
  );
  expect(again.result).toEqual(first.result);
  expect(
    (await app.queryRaw({ operation: 'customer.list', input: {} }, localUser)).data,
  ).toMatchObject({ total: 1 });
  const revision = first.revisions['customer:id-1']!;
  await app.invokeRaw(
    {
      operation: 'customer.update',
      input: { id: 'id-1', name: 'Nordhafen Netz' },
      idempotencyKey: 'rename',
      expectedRevisions: { 'customer:id-1': revision },
    },
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'customer.update',
        input: { id: 'id-1', name: 'Stale' },
        idempotencyKey: 'stale',
        expectedRevisions: { 'customer:id-1': revision },
      },
      localUser,
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
    app.queryRaw({ operation: 'customer.get', input: { id: 'missing' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
