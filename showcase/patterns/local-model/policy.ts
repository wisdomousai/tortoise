import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@tortoise/runtime';
import { approvalOperations } from '@tortoise/contracts';
import type { Role } from '@tortoise/pattern-base/server';
import { methodSuggestionsModule } from './contracts';
import type { TestRequestsLocalModelRoot } from './domain';

type Rule = OperationRule<TestRequestsLocalModelRoot, Role>;
const roleOf = (state: TestRequestsLocalModelRoot, principalId: string) =>
  own(state.testRequests.members, principalId);
const member: Rule = { allow: ({ state, context }) => !!roleOf(state, context.principalId) };
const technician: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Any member may request approval. Approving needs a person, and also passes
 * `test-request.update`'s own rule as the approver, so a viewer's approval is refused there.
 * Rejecting and expiring need a technician.
 */
const suggestionsPolicy = definePolicy<TestRequestsLocalModelRoot, Role>({
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

/** The route for the method-suggestions module. It selects the whole state to read the members. */
export const suggestionsRoute: AuthorizationRoute<TestRequestsLocalModelRoot> = {
  module: methodSuggestionsModule,
  resourceTypes: ['approval-request'],
  select: (state) => state,
  port: suggestionsPolicy as AuthorizationPort<unknown>,
};
