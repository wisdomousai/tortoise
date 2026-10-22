import { definePolicy, own, type OperationRule } from '@agent-native/runtime';
import { noteOperations } from './contracts';
import type { NotesState, Role } from './domain';

const roleOf = (state: NotesState, principalId: string) => own(state.members, principalId);
const editor: OperationRule<NotesState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Only members pass the caller gate. Reads are open to members, and adding or changing a note
 * needs an editor. An operation this policy does not list is denied.
 */
export const notesPolicy = definePolicy<NotesState, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [noteOperations.noteList.id]: 'open',
    [noteOperations.noteGet.id]: 'open',
    [noteOperations.noteAdd.id]: editor,
    [noteOperations.noteUpdate.id]: editor,
  },
  events: { note: () => true },
});
