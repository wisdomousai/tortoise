import type { ApprovalRequest } from '@tortoise/contracts';
import type { TestRequestsState } from '@tortoise/pattern-base/server';

/** The approval requests slice, next to the base pattern's `testRequests` slice. */
export interface SuggestionsState {
  approvals: Record<string, ApprovalRequest>;
}

export interface TestRequestsLocalModelRoot {
  testRequests: TestRequestsState;
  suggestions: SuggestionsState;
}
