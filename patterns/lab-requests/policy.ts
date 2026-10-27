import { definePolicy, own, type OperationRule } from '@agent-native/runtime';
import { requestOperations } from './contracts';
import type { LabRequestsState, Role } from './domain';

const roleOf = (state: LabRequestsState, principalId: string) => own(state.members, principalId);
const technician: OperationRule<LabRequestsState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Only members pass the caller gate. Reads are open to members, and submitting or changing a
 * test request needs a technician. An operation this policy does not list is denied.
 */
export const labRequestsPolicy = definePolicy<LabRequestsState, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [requestOperations.requestList.id]: 'open',
    [requestOperations.requestGet.id]: 'open',
    [requestOperations.requestSubmit.id]: technician,
    [requestOperations.requestUpdate.id]: technician,
  },
  events: { 'test-request': () => true },
});
