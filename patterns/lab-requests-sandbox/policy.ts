import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
} from '@agent-native/runtime';
import type { Role } from '@agent-native/pattern-lab-requests/server';
import { resultOperations, testResultsModule } from './contracts';
import type { LabRequestsSandboxRoot } from './domain';

const roleOf = (state: LabRequestsSandboxRoot, principalId: string) =>
  own(state.labRequests.members, principalId);
const isTechnician = (state: LabRequestsSandboxRoot, principalId: string) =>
  roleOf(state, principalId) === 'technician';
/** A run scoped to results may read or analyze only the result it was started on. */
const result = (input: unknown) => `test-result:${(input as { id: string }).id}`;

/**
 * Members read results, and technicians record readings and their statistics, by hand or through
 * a run of the result analyst. A run scoped to one result reads and analyzes only that one.
 */
const resultsPolicy = definePolicy<LabRequestsSandboxRoot, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [resultOperations.resultList.id]: 'open',
    [resultOperations.resultGet.id]: { grant: result },
    [resultOperations.resultRecord.id]: {
      allow: ({ state, context }) => isTechnician(state, context.principalId),
    },
    [resultOperations.resultAnalyze.id]: {
      grant: result,
      allow: ({ state, context }) => isTechnician(state, context.principalId),
    },
  },
  events: { 'test-result': () => true },
});

/** The route for the test results module. It selects the whole state to read the members. */
export const resultsRoute: AuthorizationRoute<LabRequestsSandboxRoot> = {
  module: testResultsModule,
  resourceTypes: ['test-result'],
  select: (state) => state,
  port: resultsPolicy as AuthorizationPort<unknown>,
};
