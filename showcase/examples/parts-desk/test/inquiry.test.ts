import { expect, test } from 'bun:test';
import { owner, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('inquiry');

/** The trial records and the IDs of two utilities: U1042 runs TR-40417, U2117 runs TR-40471. */
async function withTrialRecords() {
  const app = await open({ trialRecords: true });
  const { data } = await app.queryRaw({ operation: 'customer.list', input: {} }, owner);
  const ids = Object.fromEntries(
    (data as { items: { id: string; account: string }[] }).items.map((c) => [c.account, c.id]),
  );
  return { app, nordhafen: ids.U1042!, alpental: ids.U2117! };
}

test('the desk records an open inquiry and quotes it; members filter and search them', async () => {
  const { app, nordhafen } = await withTrialRecords();
  const call = {
    caller: 'J. Weber',
    customerId: nordhafen,
    transformerSerial: 'TR-40417',
    subject: 'HV bushing for phase 2',
  };
  const created = await app.invokeRaw(
    { operation: 'inquiry.create', input: call, idempotencyKey: 'create-1' },
    owner,
  );
  expect(created.result).toMatchObject({ ...call, status: 'open', createdBy: 'owner' });
  const { id } = created.result as { id: string };
  await app.invokeRaw(
    { operation: 'inquiry.update', input: { id, status: 'quoted' }, idempotencyKey: 'update-1' },
    owner,
  );
  const quoted = await app.queryRaw(
    { operation: 'inquiry.list', input: { status: 'quoted', customerId: nordhafen } },
    viewer,
  );
  expect(quoted.data).toMatchObject({ total: 1, items: [{ id, status: 'quoted' }] });
  for (const search of ['bushing', 'weber', 'tr-404']) {
    const found = await app.queryRaw({ operation: 'inquiry.list', input: { search } }, viewer);
    expect(found.data).toMatchObject({ total: 1 });
  }
});

test("an inquiry names a known utility and, when it names a serial, one of that utility's transformers", async () => {
  const { app, nordhafen, alpental } = await withTrialRecords();
  // A call without a serial is fine.
  await app.invokeRaw(
    {
      operation: 'inquiry.create',
      input: { caller: 'A. Huber', customerId: alpental, subject: 'Gasket prices' },
      idempotencyKey: 'no-serial',
    },
    owner,
  );
  const attempts = [
    [{ customerId: 'missing' }, 'NOT_FOUND'],
    [{ customerId: nordhafen, transformerSerial: 'TR-99999' }, 'NOT_FOUND'],
    // TR-40471 runs at Alpental, not at Nordhafen.
    [{ customerId: nordhafen, transformerSerial: 'TR-40471' }, 'INVALID_INPUT'],
    [{ customerId: nordhafen, transformerSerial: 'tr-40417' }, 'INVALID_INPUT'],
  ] as const;
  for (const [fields, code] of attempts)
    await expect(
      app.invokeRaw(
        {
          operation: 'inquiry.create',
          input: { caller: 'J. Weber', subject: 'Relay', ...fields },
          idempotencyKey: `refused-${code}-${JSON.stringify(fields)}`,
        },
        owner,
      ),
    ).rejects.toMatchObject({ code });
});

test('viewers cannot write, strangers cannot read, and a missing inquiry is NOT_FOUND', async () => {
  const { app, nordhafen } = await withTrialRecords();
  await expect(
    app.invokeRaw(
      {
        operation: 'inquiry.create',
        input: { caller: 'X', customerId: nordhafen, subject: 'X' },
        idempotencyKey: 'viewer',
      },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'inquiry.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'inquiry.get', input: { id: 'missing' } }, owner),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
