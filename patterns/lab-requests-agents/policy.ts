import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { approvalOperations } from '@agent-native/contracts';
import type { Role } from '@agent-native/pattern-lab-requests/server';
import { methodSuggestionsModule } from './contracts';
import type { LabRequestsAgentsRoot } from './domain';

type Rule = OperationRule<LabRequestsAgentsRoot, Role>;
const roleOf = (state: LabRequestsAgentsRoot, principalId: string) =>
  own(state.labRequests.members, principalId);
const member: Rule = { allow: ({ state, context }) => !!roleOf(state, context.principalId) };
const technician: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Any member may request approval. Approving needs a person, and also passes
 * `test-request.update`'s own rule as the approver, so a viewer's approval is refused there.
 * Rejecting and expiring need a technician, who could have made the change.
 */
const suggestionsPolicy = definePolicy<LabRequestsAgentsRoot, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [approvalOperations.approvalRequest.id]: member,
    [approvalOperations.approvalApprove.id]: { ...member, person: true },
    [approvalOperations.approvalReject.id]: { ...technician, person: true },
    [approvalOperations.approvalExpire.id]: technician,
    [approvalOperations.approvalList.id]: 'open',
    [approvalOperations.approvalGet.id]: 'open',
  },
  events: { 'approval-request': () => true },
});

/**
 * The route for the method-suggestions module. It selects the whole state to read the base
 * pattern's members.
 */
export const suggestionsRoute: AuthorizationRoute<LabRequestsAgentsRoot> = {
  module: methodSuggestionsModule,
  resourceTypes: ['approval-request'],
  select: (state) => state,
  port: suggestionsPolicy as AuthorizationPort<unknown>,
};
