import type { AssignmentSlice } from '@agent-native/assignments/server';
import type { NotesState } from '@agent-native/sample-notes/server';

/** Workspace state: the base `notes` slice, and the `assignment` slice the feature keeps. */
export interface NotesAssignmentsRoot {
  notes: NotesState;
  assignment?: AssignmentSlice;
}
