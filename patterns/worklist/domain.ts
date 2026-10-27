import type { WorklistSlice } from '@agent-native/assignments/server';
import type { TestRequestsState } from '@agent-native/pattern-base/server';

/** Delivers reports and done marks to the oil lab and applies the rounds it sends. */
export const INTEGRATION_PRINCIPAL = 'integration';

/** Workspace state: the base `testRequests` slice and the worklist beside it. */
export interface TestRequestsWorklistRoot {
  testRequests: TestRequestsState;
  worklist: WorklistSlice;
}
