import type { ApprovalRequest } from '@agent-native/contracts';
import type { LabRequestsState } from '@agent-native/pattern-lab-requests/server';

/** The approval requests slice, next to the base pattern's `labRequests` slice. */
export interface SuggestionsState {
  approvals: Record<string, ApprovalRequest>;
}

export interface LabRequestsLocalModelRoot {
  labRequests: LabRequestsState;
  suggestions: SuggestionsState;
}
