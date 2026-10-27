import type { AssignmentSlice } from '@agent-native/assignments/server';
import type { TestRequestsState } from '@agent-native/pattern-base/server';

/** Workspace state: the base `testRequests` slice, and the `assignment` slice the feature keeps. */
export interface TestRequestsAssignmentsRoot {
  testRequests: TestRequestsState;
  assignment?: AssignmentSlice;
}
