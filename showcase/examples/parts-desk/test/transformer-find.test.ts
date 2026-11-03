import { expect, test } from 'bun:test';
import { owner, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('transformer-find');
type Found = { items: { serial: string; customerName?: string }[]; total: number };
const serials = (data: unknown) => (data as Found).items.map((item) => item.serial);

test('a partial serial finds every transformer that starts with it, with its utility', async () => {
  const app = await open({ trialRecords: true });
  const { data } = await app.queryRaw(
    { operation: 'transformer.find', input: { serial: 'TR-404' } },
    viewer,
  );
  expect(data).toMatchObject({
    total: 2,
    items: [
      { serial: 'TR-40417', model: 'PTX-40', customerName: 'Stadtwerke Nordhafen' },
      { serial: 'TR-40471', model: 'PTX-40', customerName: 'Alpental Energie' },
    ],
  });
  // Case does not matter, and a serial matches only from its start.
  const lower = await app.queryRaw(
    { operation: 'transformer.find', input: { serial: ' tr-4047 ' } },
    owner,
  );
  expect(serials(lower.data)).toEqual(['TR-40471']);
  const middle = await app.queryRaw(
    { operation: 'transformer.find', input: { serial: '40417' } },
    owner,
  );
  expect(middle.data).toEqual({ items: [], total: 0 });
});

test('a whole serial comes first, and a find returns at most ten with the total', async () => {
  const app = await open({ trialRecords: true });
  const exact = await app.queryRaw(
    { operation: 'transformer.find', input: { serial: 'tr-40417' } },
    owner,
  );
  expect(serials(exact.data)).toEqual(['TR-40417']);
  const { data: customers } = await app.queryRaw(
    { operation: 'customer.list', input: { limit: 1 } },
    owner,
  );
  const customerId = (customers as { items: { id: string }[] }).items[0]!.id;
  for (let n = 0; n < 6; n++)
    await app.invokeRaw(
      {
        operation: 'transformer.create',
        input: {
          serial: `TR-5000${n}`,
          customerId,
          model: 'PTX-63',
          ratingMva: 63,
          voltage: '132/33 kV',
          substation: 'Test bay',
          yearInService: 2024,
          tapChanger: 'VR-400 vacuum, 19 positions',
        },
        idempotencyKey: `extra-${n}`,
      },
      owner,
    );
  const all = await app.queryRaw({ operation: 'transformer.find', input: { serial: 'TR' } }, owner);
  expect((all.data as Found).total).toBe(12);
  expect(serials(all.data)).toHaveLength(10);
  expect(serials(all.data)).toEqual([...serials(all.data)].sort());
});

test('strangers cannot find transformers', async () => {
  const app = await open({ trialRecords: true });
  await expect(
    app.queryRaw({ operation: 'transformer.find', input: { serial: 'TR' } }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
