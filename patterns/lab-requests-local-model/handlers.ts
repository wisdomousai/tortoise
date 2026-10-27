import { randomUUID } from 'node:crypto';
import { approvalHandlers, own } from '@agent-native/runtime';
import {
  requestOperations,
  type LabRequestsServices,
} from '@agent-native/pattern-lab-requests/server';
import type { LabRequestsLocalModelRoot } from './domain';

/**
 * The approval operations over the `suggestions` slice. Only `test-request.update` may be
 * requested, and every member sees every approval request, as every member sees every test
 * request.
 */
export function createSuggestionHandlers() {
  return approvalHandlers<LabRequestsLocalModelRoot, LabRequestsServices>({
    store: (state) => state.suggestions.approvals,
    commands: [requestOperations.requestUpdate],
    visible: (_, ctx) => own(ctx.state.labRequests.members, ctx.context.principalId) !== undefined,
    newId: (ctx) => (ctx.services.newId ?? randomUUID)(),
    now: (ctx) => (ctx.services.now ?? Date.now)(),
  });
}
