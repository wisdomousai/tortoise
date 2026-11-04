import { expect, test } from 'bun:test';
import { localUser, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('part');
const bushing = {
  partNumber: 'BSH-145-1250',
  description: 'HV bushing 145 kV 1250 A, OIP',
  category: 'bushing',
  assembly: 'hv-bushings',
  fits: ['PTX-40', 'PTX-63', 'PTX-40'],
  unitPrice: 1_480_000,
  stock: 2,
  leadTimeDays: 84,
};

test('the desk adds and changes parts; members filter and search them', async () => {
  const app = await open();
  const created = await app.invokeRaw(
    { operation: 'part.create', input: bushing, idempotencyKey: 'create-1' },
    localUser,
  );
  // A model listed twice is kept once.
  expect(created.result).toEqual({
    id: 'id-1',
    ...bushing,
    fits: ['PTX-40', 'PTX-63'],
    createdBy: 'local-user',
    createdAt: 1_000,
  });
  await app.invokeRaw(
    { operation: 'part.update', input: { id: 'id-1', stock: 0 }, idempotencyKey: 'update-1' },
    localUser,
  );
  const bushings = await app.queryRaw(
    { operation: 'part.list', input: { category: 'bushing', assembly: 'hv-bushings' } },
    viewer,
  );
  expect(bushings.data).toMatchObject({ total: 1, items: [{ stock: 0 }] });
  const gaskets = await app.queryRaw(
    { operation: 'part.list', input: { category: 'gasket' } },
    viewer,
  );
  expect(gaskets.data).toMatchObject({ total: 0 });
  const found = await app.queryRaw({ operation: 'part.list', input: { search: 'oip' } }, viewer);
  expect(found.data).toMatchObject({ total: 1 });
});

test('one part holds a part number, and a part fits at least one model', async () => {
  const app = await open();
  await app.invokeRaw({ operation: 'part.create', input: bushing, idempotencyKey: 'a' }, localUser);
  await expect(
    app.invokeRaw({ operation: 'part.create', input: bushing, idempotencyKey: 'b' }, localUser),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    app.invokeRaw(
      {
        operation: 'part.create',
        input: { ...bushing, partNumber: 'BSH-145-800', fits: [] },
        idempotencyKey: 'c',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('viewers cannot write, strangers cannot read, and a missing part is NOT_FOUND', async () => {
  const app = await open();
  await expect(
    app.invokeRaw({ operation: 'part.create', input: bushing, idempotencyKey: 'viewer' }, viewer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(app.queryRaw({ operation: 'part.list', input: {} }, stranger)).rejects.toMatchObject(
    { code: 'FORBIDDEN' },
  );
  await expect(
    app.queryRaw({ operation: 'part.get', input: { id: 'missing' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
