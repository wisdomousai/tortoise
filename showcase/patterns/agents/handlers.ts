import { randomUUID } from 'node:crypto';
import { approvalHandlers, own } from '@tortoise/runtime';
import { requestOperations, type TestRequestsServices } from '@tortoise/pattern-base/server';
import type { TestRequestsAgentsRoot } from './domain';

/**
 * The approval operations over the `suggestions` slice. They read the base pattern's members, so
 * they are written against the whole state instead of one slice. Only `test-request.update` may
 * be requested, and every member sees every request, as every member sees every test request.
 */
export function createSuggestionHandlers() {
  return approvalHandlers<TestRequestsAgentsRoot, TestRequestsServices>({
    store: (state) => state.suggestions.approvals,
    commands: [requestOperations.requestUpdate],
    visible: (_, ctx) => own(ctx.state.testRequests.members, ctx.context.principalId) !== undefined,
    newId: (ctx) => (ctx.services.newId ?? randomUUID)(),
    now: (ctx) => (ctx.services.now ?? Date.now)(),
  });
}
