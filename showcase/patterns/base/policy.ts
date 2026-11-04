import { definePolicy, own, type OperationRule } from '@tortoise/runtime';
import { requestOperations } from './contracts';
import type { TestRequestsState, Role } from './domain';

const roleOf = (state: TestRequestsState, principalId: string) => own(state.members, principalId);
const technician: OperationRule<TestRequestsState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Only members pass the caller gate. Reads are open to members, and submitting or changing a
 * test request needs a technician. An operation this policy does not list is denied.
 */
export const testRequestsPolicy = definePolicy<TestRequestsState, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [requestOperations.requestList.id]: 'open',
    [requestOperations.requestGet.id]: 'open',
    [requestOperations.requestSubmit.id]: technician,
    [requestOperations.requestUpdate.id]: technician,
  },
  events: { 'test-request': () => true },
});
