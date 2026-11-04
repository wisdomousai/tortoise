import { expect, test } from 'bun:test';
import { deterministicHarness } from '@tortoise/agents';
import { runAgentScenarios, type AgentScenario } from '@tortoise/testing/agent-scenarios';
import { draftQuote, localUser, supervisor, testWorkspaces, utilityIds } from './support';

// The assistant's scenarios, played by the deterministic harness and judged by what each run
// committed, requested approval for and was refused. A scripted run cannot read a result and ends
// at its first refused call, so it names record IDs it knows in advance, and a refusal and the
// approval request that should follow it are two scenarios.
const open = testWorkspaces('agent-scenarios');
const assistant = 'parts-desk.assistant';
type Application = Awaited<ReturnType<typeof open>>;

async function run(app: Application, scenarios: AgentScenario[]) {
  const results = await runAgentScenarios(scenarios, {
    application: app,
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
  return results;
}

const readQuote = async (app: Application, id: string) =>
  (await app.queryRaw({ operation: 'quote.get', input: { id } }, localUser)).data;

/** The local user's draft for TR-40417, submitted to the utility. */
async function submittedQuote(app: Application) {
  const quote = (await draftQuote(app)).result;
  await app.invokeRaw(
    { operation: 'quote.submit', input: { id: quote.id }, idempotencyKey: 'submit' },
    localUser,
  );
  return quote;
}

const cancellation = (id: string) => ({ id, reason: 'The utility ordered elsewhere' });

test('the assistant finds TR-40417, searches its bushings, creates a draft quote for two and sets 5 percent', async () => {
  const app = await open({ trialRecords: true });
  const ids = await utilityIds(app);
  const lines = [{ partNumber: 'BSH-145-1250', quantity: 2 }];
  // The fixture's next record ID: the trial records take id-1 to id-33 (three utilities, six
  // transformers and 24 parts), so quote.create makes id-34.
  const quoteId = 'id-34';
  const discount = { id: quoteId, percent: 5, reason: 'Framework agreement 2026' };
  await run(app, [
    {
      name: 'a draft quote for two HV bushings at 5 percent',
      agent: assistant,
      task: 'Stadtwerke Nordhafen needs two HV bushings for TR-40417. Create the draft quote with 5 percent off under the framework agreement 2026.',
      issuer: localUser,
      script: {
        commands: [
          { operation: 'transformer.find', input: { serial: 'TR-40417' } },
          {
            operation: 'part.search',
            input: { transformerSerial: 'TR-40417', category: 'bushing' },
          },
          {
            operation: 'quote.create',
            input: { customerId: ids.U1042!, transformerSerial: 'TR-40417', lines },
          },
          { operation: 'quote.discount', input: discount },
        ],
      },
      expect: {
        commits: [
          { operation: 'quote.create', input: { transformerSerial: 'TR-40417', lines } },
          { operation: 'quote.discount', input: discount },
        ],
        approvals: [],
        outcome: 'succeeded',
      },
      async check(result, application) {
        const created = result.commits[0]!.commandResult!.result as { id: string };
        expect(created.id).toBe(quoteId);
        const stored = await application.queryRaw(
          { operation: 'quote.get', input: { id: quoteId } },
          localUser,
        );
        // The run acts as the person who started it, so the quote is theirs.
        expect(stored.data).toMatchObject({
          number: 'Q-00001',
          status: 'draft',
          discountPercent: 5,
          total: 2_812_000,
          createdBy: localUser.principalId,
        });
      },
    },
  ]);
});

test('a cancellation without approval is FORBIDDEN, commits nothing and leaves the quote submitted', async () => {
  const app = await open({ trialRecords: true });
  const quote = await submittedQuote(app);
  await run(app, [
    {
      name: 'the assistant cancels a submitted quote itself',
      agent: assistant,
      task: `Cancel ${quote.number}, the utility ordered elsewhere.`,
      issuer: localUser,
      script: { commands: [{ operation: 'quote.cancel', input: cancellation(quote.id) }] },
      expect: {
        commits: [],
        approvals: [],
        // The grant of a run under the assistant never holds quote.cancel.
        refused: [{ operation: 'quote.cancel', code: 'FORBIDDEN' }],
        outcome: 'failed',
      },
    },
  ]);
  expect(await readQuote(app, quote.id)).toMatchObject({ status: 'submitted' });
});

test('the assistant requests approval for a cancellation, and the cancellation runs as the supervisor who approves it', async () => {
  const app = await open({ trialRecords: true });
  const quote = await submittedQuote(app);
  const resource = `quote:${quote.id}`;
  const [result] = await run(app, [
    {
      // #region approval
      name: 'the assistant requests approval to cancel a submitted quote',
      agent: assistant,
      task: `Cancel ${quote.number}, the utility ordered elsewhere.`,
      issuer: localUser,
      script: {
        commands: [
          {
            operation: 'approval.request',
            input: {
              operation: 'quote.cancel',
              input: cancellation(quote.id),
              rationale: 'The utility ordered elsewhere.',
              resource,
            },
          },
        ],
      },
      expect: {
        commits: [],
        approvals: [{ operation: 'quote.cancel', input: cancellation(quote.id), resource }],
        outcome: 'succeeded',
      },
      // #endregion approval
    },
  ]);
  expect(await readQuote(app, quote.id)).toMatchObject({ status: 'submitted' });

  const request = result!.calls[0]!.commandResult!.result as { id: string; requestedBy: string };
  expect(request).toMatchObject({ status: 'pending', requestedBy: localUser.principalId });
  const approved = await app.invokeRaw(
    { operation: 'approval.approve', input: { id: request.id }, idempotencyKey: 'approve' },
    supervisor,
  );
  // Approving runs quote.cancel in the supervisor's transaction, under the supervisor's policy.
  expect(approved.continuation).toMatchObject({
    operation: 'quote.cancel',
    result: { id: quote.id, status: 'cancelled' },
  });
  const { data } = await app.queryRaw(
    { operation: 'approval.get', input: { id: request.id } },
    localUser,
  );
  expect(data).toMatchObject({ status: 'approved', closedBy: supervisor.principalId });
  expect(await readQuote(app, quote.id)).toMatchObject({
    status: 'cancelled',
    cancelReason: 'The utility ordered elsewhere',
  });
});

test('the policy refuses the assistant 15 percent and accepts an approval request for it', async () => {
  const app = await open({ trialRecords: true });
  const quote = (await draftQuote(app)).result;
  const discount = { id: quote.id, percent: 15, reason: 'A late delivery' };
  const resource = `quote:${quote.id}`;
  const task = `The utility wants 15 percent off ${quote.number} because of a late delivery.`;
  await run(app, [
    {
      name: 'the assistant sets 15 percent itself',
      agent: assistant,
      task,
      issuer: localUser,
      script: { commands: [{ operation: 'quote.discount', input: discount }] },
      expect: {
        commits: [],
        approvals: [],
        // The grant holds quote.discount; the policy refuses an agent run more than 10 percent.
        refused: [{ operation: 'quote.discount', code: 'FORBIDDEN' }],
        outcome: 'failed',
      },
    },
    {
      name: 'the assistant requests approval for 15 percent',
      agent: assistant,
      task,
      issuer: localUser,
      script: {
        commands: [
          {
            operation: 'approval.request',
            input: {
              operation: 'quote.discount',
              input: discount,
              rationale: 'A late delivery.',
              resource,
            },
          },
        ],
      },
      expect: {
        commits: [],
        approvals: [{ operation: 'quote.discount', input: discount, resource }],
        outcome: 'succeeded',
      },
    },
  ]);
  expect(await readQuote(app, quote.id)).toMatchObject({ discountPercent: 0 });
});

test('for TR-404 the assistant asks which transformer, and searches the parts of TR-40471 the person names', async () => {
  const app = await open({ trialRecords: true });
  const [result] = await run(app, [
    {
      name: 'the assistant asks which transformer TR-404 is',
      agent: assistant,
      task: 'Which bushings fit TR-404?',
      issuer: localUser,
      // The harness asks before its calls; the scenario's answer names TR-40471.
      script: {
        question: 'TR-404 matches TR-40417 and TR-40471. Which transformer do you mean?',
        commands: [
          { operation: 'transformer.find', input: { serial: 'TR-40471' } },
          {
            operation: 'part.search',
            input: { transformerSerial: 'TR-40471', category: 'bushing' },
          },
        ],
      },
      answers: ['TR-40471'],
      expect: { commits: [], approvals: [], questions: 1, outcome: 'succeeded' },
    },
  ]);
  expect(result!.calls.map((call) => [call.operation, call.outcome])).toEqual([
    ['transformer.find', 'read'],
    ['part.search', 'read'],
  ]);
});
