import {
  definePolicy,
  isDelegated,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
} from '@agent-native/runtime';
import type { AssignmentAccess } from '@agent-native/assignments/server';
import type { Role } from '@agent-native/pattern-base/server';
import { samplingModule, samplingOperations } from './contracts';
import type { TestRequestsAssignmentsRoot } from './domain';

const roleOf = (state: TestRequestsAssignmentsRoot, principalId: string) =>
  own(state.testRequests.members, principalId);

/**
 * Who may do what with sampling rounds. The feature never consults the application's policy, so
 * this repeats the base pattern's membership gate.
 *
 * - A peer application, as its service principal, only works on what was sent to it.
 * - Technicians plan, read and review; every member works on the rounds sent to them.
 * - A run acting for a technician only reads: the sampling kind takes no agent assignee, and
 *   planning and reviewing stay with people.
 */
export const samplingAccess = (state: TestRequestsAssignmentsRoot): AssignmentAccess => ({
  allows(context, action) {
    if (context.peer) return context.peer.subject === undefined && action === 'work';
    const role = roleOf(state, context.principalId);
    if (!role) return false;
    if (isDelegated(context)) return action === 'read' && role === 'technician';
    if (role === 'technician') return action !== 'integrate';
    return action === 'work';
  },
});

/** Members list who can take a sampling round. */
const samplingPolicy = definePolicy<TestRequestsAssignmentsRoot, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: { [samplingOperations.assigneeList.id]: 'open' },
  events: {},
});

/** The route for the sampling module. It selects the whole state to read the members. */
export const samplingRoute: AuthorizationRoute<TestRequestsAssignmentsRoot> = {
  module: samplingModule,
  resourceTypes: [],
  select: (state) => state,
  port: samplingPolicy as AuthorizationPort<unknown>,
};
