import type { WorklistSlice } from '@agent-native/assignments/server';
import type { NotesState } from '@agent-native/sample-notes/server';

/** Delivers reports and done marks to notes-assignments and applies the reviews it sends. */
export const INTEGRATION_PRINCIPAL = 'integration';

/** Workspace state: the base `notes` slice and the worklist beside it. */
export interface NotesWorklistRoot {
  notes: NotesState;
  worklist: WorklistSlice;
}
