import type { LabRequestsState } from '@agent-native/sample-lab-requests/server';
import type { TestResult } from './contracts';

/** The test results slice, next to the base sample's `labRequests` slice. */
export interface TestResultsState {
  results: Record<string, TestResult>;
}

export interface LabRequestsSandboxRoot {
  labRequests: LabRequestsState;
  testResults: TestResultsState;
}
