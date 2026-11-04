import type { AssignmentSlice } from '@tortoise/assignments/server';
import type { TestRequestsState } from '@tortoise/pattern-base/server';

/** Workspace state: the base `testRequests` slice, and the `assignment` slice the feature keeps. */
export interface TestRequestsAssignmentsRoot {
  testRequests: TestRequestsState;
  assignment?: AssignmentSlice;
}
