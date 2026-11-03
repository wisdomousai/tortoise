import { expect, test } from 'bun:test';
import { draftQuote, owner, supervisor, testWorkspaces, viewer } from './support';

const open = testWorkspaces('quote-discount');

/** A run of mara's under an agent definition: the host's agent grant names the agent. */
const maraAgentRun = {
  ...supervisor,
  runId: 'run-1',
  grant: {
    operations: ['quote.discount'],
    agent: 'parts-desk.quoting',
    principalId: 'mara',
    workspaceId: 'local',
    runId: 'run-1',
  },
};

async function withDraft() {
  const app = await open({ trialRecords: true });
  const quote = (await draftQuote(app)).result;
  const discount = (percent: number, caller: typeof owner, key: string) =>
    app.invokeRaw(
      {
        operation: 'quote.discount',
        input: { id: quote.id, percent, reason: 'Framework agreement' },
        idempotencyKey: key,
      },
      caller,
    );
  return { app, quote, discount };
}

test('the desk sets 10 percent and is refused 12 percent with FORBIDDEN', async () => {
  const { app, quote, discount } = await withDraft();
  const ten = await discount(10, owner, 'ten');
  expect(ten.result).toMatchObject({
    discountPercent: 10,
    discountReason: 'Framework agreement',
    total: 1_456_200,
  });
  await expect(discount(12, owner, 'twelve')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(discount(5, viewer, 'viewer')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const read = await app.queryRaw({ operation: 'quote.get', input: { id: quote.id } }, owner);
  expect(read.data).toMatchObject({ discountPercent: 10, total: 1_456_200 });
});

test('a supervisor sets 12 percent', async () => {
  const { discount } = await withDraft();
  const twelve = await discount(12, supervisor, 'twelve');
  // 1,618,000 cents less 12 percent.
  expect(twelve.result).toMatchObject({ discountPercent: 12, total: 1_423_840 });
});

test("a run under an agent definition never sets more than 10 percent, not even a supervisor's", async () => {
  const { discount } = await withDraft();
  await expect(discount(12, maraAgentRun, 'agent-twelve')).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await discount(10, maraAgentRun, 'agent-ten')).result).toMatchObject({
    discountPercent: 10,
  });
});

test('a submitted or cancelled quote refuses a discount with CONFLICT', async () => {
  const { app, quote, discount } = await withDraft();
  await app.invokeRaw(
    { operation: 'quote.submit', input: { id: quote.id }, idempotencyKey: 'submit' },
    owner,
  );
  await expect(discount(5, owner, 'submitted')).rejects.toMatchObject({ code: 'CONFLICT' });
  // A supervisor passes the policy, and the quote still takes no discount once submitted.
  await expect(discount(12, supervisor, 'submitted-supervisor')).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  await app.invokeRaw(
    {
      operation: 'quote.cancel',
      input: { id: quote.id, reason: 'Ordered elsewhere' },
      idempotencyKey: 'cancel',
    },
    owner,
  );
  await expect(discount(5, owner, 'cancelled')).rejects.toMatchObject({ code: 'CONFLICT' });
});
