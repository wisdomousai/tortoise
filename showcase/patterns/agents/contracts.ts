import { approvalOperations, defineAgent, defineModule } from '@agent-native/contracts';

/**
 * Suggests a test method for a request that has none. It may read test requests and ask for
 * `test-request.update`; a technician approves or rejects each request, and approving runs the
 * update as that person.
 */
export const methodSuggester = defineAgent({
  id: 'test-request.method-suggester',
  title: 'Test method suggester',
  instructions:
    'Find test requests with an empty method. Read each with test-request.get, then request approval for test-request.update with the test method its description asks for (resource test-request:<id>, with the revision you read as baseRevisions). Never request approval to change the sample, the transformer or the description.',
  operations: ['test-request.list', 'test-request.get', 'test-request.update', 'approval.list'],
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 6, toolCalls: 20, wallTimeMs: 120_000 },
});

/** Approval requests for test request changes, and the method suggester. Browser-safe. */
export const methodSuggestionsModule = defineModule({
  id: 'method-suggestions',
  capabilities: Object.values(approvalOperations),
  agents: [methodSuggester],
});
