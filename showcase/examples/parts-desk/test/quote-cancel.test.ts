import { expect, test } from 'bun:test';
import { draftQuote, owner, testWorkspaces, viewer } from './support';

const open = testWorkspaces('quote-cancel');

test('the desk cancels a draft or a submitted quote with a reason; a cancelled quote is CONFLICT', async () => {
  const app = await open({ trialRecords: true });
  const cancel = (id: string, key: string, caller = owner) =>
    app.invokeRaw(
      {
        operation: 'quote.cancel',
        input: { id, reason: 'Ordered elsewhere' },
        idempotencyKey: key,
      },
      caller,
    );
  const draft = (await draftQuote(app, 'draft')).result;
  expect((await cancel(draft.id, 'cancel-draft')).result).toMatchObject({
    status: 'cancelled',
    cancelReason: 'Ordered elsewhere',
  });
  await expect(cancel(draft.id, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
  const sent = (await draftQuote(app, 'sent')).result;
  await app.invokeRaw(
    { operation: 'quote.submit', input: { id: sent.id }, idempotencyKey: 'submit' },
    owner,
  );
  expect((await cancel(sent.id, 'cancel-sent')).result).toMatchObject({ status: 'cancelled' });
  await expect(cancel(sent.id, 'viewer', viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
