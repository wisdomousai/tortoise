import { expect, test } from 'bun:test';
import { draftQuote, owner, supervisor, testWorkspaces, viewer } from './support';

const open = testWorkspaces('quote-submit');

test('the desk submits a draft once; a submitted or cancelled quote is CONFLICT', async () => {
  const app = await open({ trialRecords: true });
  const submit = (id: string, key: string, caller = owner) =>
    app.invokeRaw({ operation: 'quote.submit', input: { id }, idempotencyKey: key }, caller);
  const first = (await draftQuote(app, 'first')).result;
  expect((await submit(first.id, 'submit')).result).toMatchObject({ status: 'submitted' });
  await expect(submit(first.id, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
  // A supervisor works the desk too.
  const second = (await draftQuote(app, 'second')).result;
  await app.invokeRaw(
    {
      operation: 'quote.cancel',
      input: { id: second.id, reason: 'Duplicate' },
      idempotencyKey: 'cancel',
    },
    supervisor,
  );
  await expect(submit(second.id, 'cancelled', supervisor)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  const submitted = await app.queryRaw(
    { operation: 'quote.list', input: { status: 'submitted' } },
    viewer,
  );
  expect(submitted.data).toMatchObject({ total: 1, items: [{ id: first.id }] });
});

test('viewers cannot submit and a missing quote is NOT_FOUND', async () => {
  const app = await open({ trialRecords: true });
  const quote = (await draftQuote(app)).result;
  await expect(
    app.invokeRaw(
      { operation: 'quote.submit', input: { id: quote.id }, idempotencyKey: 'viewer' },
      viewer,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    app.invokeRaw(
      { operation: 'quote.submit', input: { id: 'missing' }, idempotencyKey: 'missing' },
      owner,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
