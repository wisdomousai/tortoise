import type { TestRequestsState } from '@agent-native/pattern-base/server';
import type { TestResult } from './contracts';

/** The test results slice, next to the base pattern's `testRequests` slice. */
export interface TestResultsState {
  results: Record<string, TestResult>;
}

export interface TestRequestsSandboxRoot {
  testRequests: TestRequestsState;
  testResults: TestResultsState;
}
