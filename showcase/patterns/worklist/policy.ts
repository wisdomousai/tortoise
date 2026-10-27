import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { worklistRules } from '@agent-native/assignments/server';
import type { Role } from '@agent-native/pattern-base/server';
import { worklist, worklistOperations } from './contracts';
import { INTEGRATION_PRINCIPAL, type TestRequestsWorklistRoot } from './domain';

type Rule = OperationRule<TestRequestsWorklistRoot, Role>;
const roleOf = (state: TestRequestsWorklistRoot, principalId: string) =>
  own(state.testRequests.members, principalId);
const member = (state: TestRequestsWorklistRoot, context: { principalId: string }) =>
  roleOf(state, context.principalId) !== undefined;
const technician: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'technician',
};

/**
 * Members see the worklist; technicians report samples and mark rounds done. The integration
 * principal only completes deliveries and applies the rounds the oil lab sends, and nobody else
 * may.
 */
const worklistPolicy = definePolicy<TestRequestsWorklistRoot, Role>({
  integrations: [
    {
      is: (_state, principalId) => principalId === INTEGRATION_PRINCIPAL,
      operations: worklist.target.integrationOperations,
    },
  ],
  caller: { allow: member },
  operations: {
    ...worklistRules(worklist),
    [worklistOperations.samplingReport.id]: technician,
    [worklistOperations.complete.id]: technician,
  },
  events: {
    'worklist-assignment': (_id, state, context) => member(state, context),
    'worklist-report': (_id, state, context) => member(state, context),
    sync: (_id, state, context) => member(state, context),
  },
});

/** The route for the worklist module. It selects the whole state to read the base members. */
export const worklistRoute: AuthorizationRoute<TestRequestsWorklistRoot> = {
  module: worklist.module,
  resourceTypes: ['worklist-assignment', 'worklist-report', 'sync'],
  select: (state) => state,
  port: worklistPolicy as AuthorizationPort<unknown>,
};
