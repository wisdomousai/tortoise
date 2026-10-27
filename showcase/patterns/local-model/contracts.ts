import { approvalOperations, defineAgent, defineModule } from '@agent-native/contracts';
import { modelServer } from '@agent-native/model-server/contracts';

/** The model entry the method suggester runs on; the deployment chooses its weights. */
export const METHOD_MODEL = 'lab-methods';

/** The model server process, which the site policy binds to llama-server and pins. */
export const methodModelServer = modelServer({ id: 'llm', runtime: 'llama-server' });

/**
 * Suggests the test method for one test request, on the local `lab-methods` model only. It may
 * read test requests and ask for `test-request.update`; a technician approves or rejects each
 * request, and approving runs the update as that person.
 */
export const methodSuggester = defineAgent({
  id: 'test-request.method-suggester',
  title: 'Test method suggester',
  instructions:
    'The test request named below was just submitted. Read it with test-request.get. If its method is empty, request approval for test-request.update with the test method its description asks for (resource test-request:<id>, with the revision you read as baseRevisions). Never request approval to change the sample, the transformer or the description. When the method is set, or no method fits, stop.',
  operations: ['test-request.get', 'test-request.update', 'approval.list'],
  model: 'local',
  models: [METHOD_MODEL],
  output: 'request-approval',
  // A local model that reasons before it calls a tool takes tens of seconds per turn on a laptop.
  budgets: { turns: 4, toolCalls: 4, wallTimeMs: 300_000 },
});

/** Approval requests for test request changes, and the method suggester. Browser-safe. */
export const methodSuggestionsModule = defineModule({
  id: 'method-suggestions',
  capabilities: Object.values(approvalOperations),
  agents: [methodSuggester],
});
