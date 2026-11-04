import { expect, test } from 'bun:test';
import { agentInstructions } from '@tortoise/contracts';
import { agentGrant } from '@tortoise/runtime';
import { operations } from '../contracts';
import { localUser, testWorkspaces } from './support';

// What the desk's assistant may call and what its instructions tell a model. Its scripted runs are
// in agent-scenarios.test.ts.
const open = testWorkspaces('assistant');
const assistant = 'parts-desk.assistant';

test("the assistant's grant holds approval.request and not quote.cancel", async () => {
  const app = await open();
  const { operations: granted } = agentGrant(app.catalog, assistant, localUser, { now: 0 });
  expect(granted).toContain('approval.request');
  expect(granted).not.toContain('quote.cancel');
  // Every query of the desk, and quote.create's inquiry.update, which it runs in its transaction.
  // member.current serves the screens: the assistant reads records, not the caller's role.
  const queries = Object.values(operations)
    .filter((operation) => operation.kind === 'query' && operation.id !== 'member.current')
    .map((operation) => operation.id);
  expect([...granted].sort()).toEqual(
    [
      ...queries,
      'quote.create',
      'quote.update',
      'quote.discount',
      'quote.submit',
      'inquiry.update',
      'approval.request',
    ].sort(),
  );
  // The model learns the requested commands and their inputs only from its instructions.
  const instructions = agentInstructions(app.catalog, assistant);
  for (const { id, description } of [operations.quoteDiscount, operations.quoteCancel])
    expect(instructions).toContain(`- \`${id}\`: ${description}\n  Input schema: {`);
});
