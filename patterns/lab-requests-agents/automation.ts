import { approvalOperations } from '@agent-native/contracts';
import { defineTrigger } from '@agent-native/automation/contracts';
import type { Job } from '@agent-native/automation/jobs';
import { createAutomationPlugin } from '@agent-native/automation/plugin';
import { requestOperations, type TestRequest } from '@agent-native/pattern-lab-requests/server';
import { methodFor } from './method';

/**
 * When a test request is submitted without a method, request approval to set the method its
 * description asks for. It runs as the person who enabled it, narrowed to reading a request and
 * requesting approval, so it never changes a request itself. A job, so it needs no model.
 */
export const suggestMethodsForNewRequests = defineTrigger({
  id: 'suggest-methods-for-new-requests',
  title: 'Suggest test methods for new requests',
  on: {
    event: { resourceType: 'test-request', operations: [requestOperations.requestSubmit.id] },
  },
  run: {
    job: 'suggest-method',
    operations: [requestOperations.requestGet.id, approvalOperations.approvalRequest.id],
  },
  budgets: { toolCalls: 5, wallTimeMs: 30_000 },
});

export const suggestMethod: Job = async ({ event, query, command }) => {
  if (!event) return;
  const id = event.resource.slice('test-request:'.length);
  const { data: request } = await query<TestRequest & { revision: number }>(
    requestOperations.requestGet.id,
    { id },
  );
  const method = methodFor(request.description);
  if (request.method || !method) return;
  await command(approvalOperations.approvalRequest.id, {
    operation: requestOperations.requestUpdate.id,
    input: { id, method },
    rationale: 'The request has no test method; its description names this test.',
    resource: event.resource,
    baseRevisions: { [event.resource]: request.revision },
  });
};

export const createMethodAutomation = (options: { intervalMs?: number } = {}) =>
  createAutomationPlugin({
    triggers: [suggestMethodsForNewRequests],
    jobs: { 'suggest-method': suggestMethod },
    ...(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
  });
