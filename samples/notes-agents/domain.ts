import type { ApprovalRequest } from '@agent-native/contracts';
import type { NotesState } from '@agent-native/sample-notes/server';

/** The approval requests slice, next to the base sample's `notes` slice. */
export interface TitlesState {
  approvals: Record<string, ApprovalRequest>;
}

export interface NotesAgentsRoot {
  notes: NotesState;
  titles: TitlesState;
}
