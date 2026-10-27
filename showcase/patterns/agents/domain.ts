import type { ApprovalRequest } from '@agent-native/contracts';
import type { TestRequestsState } from '@agent-native/pattern-base/server';

/** The approval requests slice, next to the base pattern's `testRequests` slice. */
export interface SuggestionsState {
  approvals: Record<string, ApprovalRequest>;
}

export interface TestRequestsAgentsRoot {
  testRequests: TestRequestsState;
  suggestions: SuggestionsState;
}
