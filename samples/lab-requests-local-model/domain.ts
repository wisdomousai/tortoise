import type { ApprovalRequest } from '@agent-native/contracts';
import type { LabRequestsState } from '@agent-native/sample-lab-requests/server';

/** The approval requests slice, next to the base sample's `labRequests` slice. */
export interface SuggestionsState {
  approvals: Record<string, ApprovalRequest>;
}

export interface LabRequestsLocalModelRoot {
  labRequests: LabRequestsState;
  suggestions: SuggestionsState;
}
