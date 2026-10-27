import { defineTrigger } from '@agent-native/automation/contracts';
import { requestOperations } from '@agent-native/pattern-lab-requests/contracts';
import { methodSuggester } from './contracts';

/**
 * When a test request is submitted, the method suggester runs on the local model with the new
 * request as its selection. It runs as the person who enabled the trigger, narrowed to the
 * agent's operations, so it never changes a request itself.
 */
export const suggestMethodsOnLocalModel = defineTrigger({
  id: 'suggest-methods-on-local-model',
  title: 'Suggest test methods on the local model',
  on: {
    event: { resourceType: 'test-request', operations: [requestOperations.requestSubmit.id] },
  },
  run: { agent: methodSuggester.id },
  prompt: 'Suggest the test method for the test request this event names.',
});
