import { expect, test } from 'bun:test';
import { localUser, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('transformer');
const unit = {
  serial: 'TR-40417',
  model: 'PTX-40',
  ratingMva: 40,
  voltage: '110/20 kV',
  substation: 'Nordhafen Ost',
  yearInService: 2009,
  tapChanger: 'VR-400 vacuum, 17 positions',
};

async function withUtility() {
  const app = await open();
  await app.invokeRaw(
    {
      operation: 'customer.create',
      input: { account: 'U1042', name: 'Stadtwerke Nordhafen', phone: '+49 40 5550 1042' },
      idempotencyKey: 'utility',
    },
    localUser,
  );
  return app;
}

test('the desk adds and changes transformers; members filter and search them', async () => {
  const app = await withUtility();
  const created = await app.invokeRaw(
    {
      operation: 'transformer.create',
      input: { ...unit, customerId: 'id-1' },
      idempotencyKey: 'create-1',
    },
    localUser,
  );
  expect(created.result).toEqual({
    id: 'id-2',
    ...unit,
    customerId: 'id-1',
    createdBy: 'local-user',
    createdAt: 1_000,
  });
  await app.invokeRaw(
    {
      operation: 'transformer.update',
      input: { id: 'id-2', substation: 'Nordhafen West' },
      idempotencyKey: 'update-1',
    },
    localUser,
  );
  const byModel = await app.queryRaw(
    { operation: 'transformer.list', input: { model: 'PTX-40', customerId: 'id-1' } },
    viewer,
  );
  expect(byModel.data).toMatchObject({ total: 1, items: [{ substation: 'Nordhafen West' }] });
  const other = await app.queryRaw(
    { operation: 'transformer.list', input: { model: 'PTX-63' } },
    viewer,
  );
  expect(other.data).toMatchObject({ total: 0 });
  const found = await app.queryRaw(
    { operation: 'transformer.list', input: { search: 'west' } },
    viewer,
  );
  expect(found.data).toMatchObject({ total: 1 });
});

test('a serial is unique, well formed and names a known utility', async () => {
  const app = await withUtility();
  await app.invokeRaw(
    {
      operation: 'transformer.create',
      input: { ...unit, customerId: 'id-1' },
      idempotencyKey: 'a',
    },
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'transformer.create',
        input: { ...unit, customerId: 'id-1' },
        idempotencyKey: 'b',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    app.invokeRaw(
      {
        operation: 'transformer.create',
        input: { ...unit, serial: 'TR-4041', customerId: 'id-1' },
        idempotencyKey: 'c',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    app.invokeRaw(
      {
        operation: 'transformer.create',
        input: { ...unit, serial: 'TR-40418', customerId: 'missing' },
        idempotencyKey: 'd',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test('viewers cannot write, strangers cannot read, and a missing transformer is NOT_FOUND', async () => {
  const app = await withUtility();
  await expect(
    app.invokeRaw(
      {
        operation: 'transformer.create',
        input: { ...unit, customerId: 'id-1' },
        idempotencyKey: 'viewer',
      },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'transformer.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'transformer.get', input: { id: 'missing' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
