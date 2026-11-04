import { expect, test } from 'bun:test';
import { draftQuote, localUser, stranger, testWorkspaces, utilityIds, viewer } from './support';

const open = testWorkspaces('quote');
const bushing = { partNumber: 'BSH-145-1250', quantity: 1 };

test('the desk drafts a quote with the prices of the parts and sets its inquiry to quoted', async () => {
  const app = await open({ trialRecords: true });
  const ids = await utilityIds(app);
  const inquiry = await app.invokeRaw(
    {
      operation: 'inquiry.create',
      input: {
        caller: 'J. Weber',
        customerId: ids.U1042!,
        transformerSerial: 'TR-40417',
        subject: 'HV bushing and tank gaskets',
      },
      idempotencyKey: 'inquiry',
    },
    localUser,
  );
  const inquiryId = (inquiry.result as { id: string }).id;
  const created = await app.invokeRaw(
    {
      operation: 'quote.create',
      input: {
        customerId: ids.U1042!,
        transformerSerial: 'TR-40417',
        inquiryId,
        lines: [bushing, { partNumber: 'GSK-TC-40', quantity: 2 }],
      },
      idempotencyKey: 'quote',
    },
    localUser,
  );
  const quote = created.result as { id: string };
  expect(created.result).toEqual({
    id: quote.id,
    number: 'Q-00001',
    customerId: ids.U1042!,
    transformerSerial: 'TR-40417',
    inquiryId,
    lines: [
      {
        partNumber: 'BSH-145-1250',
        description: 'HV bushing 145 kV 1250 A, OIP',
        quantity: 1,
        unitPrice: 1_480_000,
      },
      {
        partNumber: 'GSK-TC-40',
        description: 'Tank cover gasket, nitrile',
        quantity: 2,
        unitPrice: 69_000,
      },
    ],
    discountPercent: 0,
    status: 'draft',
    total: 1_618_000,
    createdBy: 'local-user',
    createdAt: 1_000,
  });
  // The inquiry changed in the same command: its revision is on the quote's receipt.
  expect(Object.keys(created.revisions).sort()).toEqual([
    `inquiry:${inquiryId}`,
    `quote:${quote.id}`,
  ]);
  const read = await app.queryRaw({ operation: 'inquiry.get', input: { id: inquiryId } }, viewer);
  expect(read.data).toMatchObject({ status: 'quoted' });
  // Numbers follow in order.
  expect((await draftQuote(app, 'second')).result).toMatchObject({ number: 'Q-00002' });
  const listed = await app.queryRaw(
    { operation: 'quote.list', input: { status: 'draft', search: 'q-00002' } },
    viewer,
  );
  expect(listed.data).toMatchObject({ total: 1, items: [{ number: 'Q-00002' }] });
});

test("a quote refuses another utility's transformer and a part that does not fit", async () => {
  const app = await open({ trialRecords: true });
  const ids = await utilityIds(app);
  const other = await app.invokeRaw(
    {
      operation: 'inquiry.create',
      input: { caller: 'A. Huber', customerId: ids.U2117!, subject: 'Gaskets' },
      idempotencyKey: 'other-inquiry',
    },
    localUser,
  );
  const attempts = [
    // TR-40471 runs at Alpental, not at Nordhafen.
    [{ transformerSerial: 'TR-40471' }, 'INVALID_INPUT'],
    // BSH-245-1600 fits the PTX-100 only, and TR-40417 is a PTX-40.
    [{ lines: [{ partNumber: 'BSH-245-1600', quantity: 1 }] }, 'INVALID_INPUT'],
    [{ lines: [bushing, { partNumber: 'GSK-TC-63', quantity: 1 }] }, 'INVALID_INPUT'],
    [{ lines: [{ partNumber: 'BSH-999-0000', quantity: 1 }] }, 'NOT_FOUND'],
    [{ lines: [{ ...bushing, quantity: 100 }] }, 'INVALID_INPUT'],
    [{ transformerSerial: 'TR-99999' }, 'NOT_FOUND'],
    [{ inquiryId: (other.result as { id: string }).id }, 'INVALID_INPUT'],
    [{ customerId: 'missing' }, 'NOT_FOUND'],
  ] as const;
  for (const [fields, code] of attempts)
    await expect(
      app.invokeRaw(
        {
          operation: 'quote.create',
          input: {
            customerId: ids.U1042!,
            transformerSerial: 'TR-40417',
            lines: [bushing],
            ...fields,
          },
          idempotencyKey: `refused-${JSON.stringify(fields)}`,
        },
        localUser,
      ),
    ).rejects.toMatchObject({ code });
  expect(
    (await app.queryRaw({ operation: 'quote.list', input: {} }, localUser)).data,
  ).toMatchObject({
    total: 0,
  });
});

test('quote.update replaces the lines of a draft and keeps the discount', async () => {
  const app = await open({ trialRecords: true });
  const quote = (await draftQuote(app)).result;
  await app.invokeRaw(
    {
      operation: 'quote.discount',
      input: { id: quote.id, percent: 10, reason: 'Framework agreement' },
      idempotencyKey: 'discount',
    },
    localUser,
  );
  const updated = await app.invokeRaw(
    {
      operation: 'quote.update',
      input: { id: quote.id, lines: [{ partNumber: 'BSH-24-3150', quantity: 3 }] },
      idempotencyKey: 'update',
    },
    localUser,
  );
  // 3 × 1,980.00 = 5,940.00, less 10 percent.
  expect(updated.result).toMatchObject({
    lines: [{ partNumber: 'BSH-24-3150', quantity: 3, unitPrice: 198_000 }],
    discountPercent: 10,
    total: 534_600,
  });
  await expect(
    app.invokeRaw(
      {
        operation: 'quote.update',
        input: { id: quote.id, lines: [{ partNumber: 'BSH-245-1600', quantity: 1 }] },
        idempotencyKey: 'not-fitting',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await app.invokeRaw(
    { operation: 'quote.submit', input: { id: quote.id }, idempotencyKey: 'submit' },
    localUser,
  );
  await expect(
    app.invokeRaw(
      {
        operation: 'quote.update',
        input: { id: quote.id, lines: [bushing] },
        idempotencyKey: 'late',
      },
      localUser,
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('a repeated key returns the first receipt and a stale revision is refused', async () => {
  const app = await open({ trialRecords: true });
  const first = await draftQuote(app, 'once');
  expect((await draftQuote(app, 'once')).result).toEqual(first.result);
  expect(
    (await app.queryRaw({ operation: 'quote.list', input: {} }, localUser)).data,
  ).toMatchObject({
    total: 1,
  });
  const resource = `quote:${first.result.id}`;
  const revision = first.revisions[resource]!;
  const update = (key: string) =>
    app.invokeRaw(
      {
        operation: 'quote.update',
        input: { id: first.result.id, lines: [bushing] },
        idempotencyKey: key,
        expectedRevisions: { [resource]: revision },
      },
      localUser,
    );
  await update('fresh');
  await expect(update('stale')).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('viewers cannot write, strangers cannot read, and a missing quote is NOT_FOUND', async () => {
  const app = await open({ trialRecords: true });
  const ids = await utilityIds(app);
  await expect(
    app.invokeRaw(
      {
        operation: 'quote.create',
        input: { customerId: ids.U1042!, transformerSerial: 'TR-40417', lines: [bushing] },
        idempotencyKey: 'viewer',
      },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'quote.list', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.queryRaw({ operation: 'quote.get', input: { id: 'missing' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
