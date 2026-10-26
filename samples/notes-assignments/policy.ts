import {
  definePolicy,
  isDelegated,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
} from '@agent-native/runtime';
import type { AssignmentAccess } from '@agent-native/assignments/server';
import type { Role } from '@agent-native/sample-notes/server';
import { noteReviewsModule, reviewOperations } from './contracts';
import type { NotesAssignmentsRoot } from './domain';

const roleOf = (state: NotesAssignmentsRoot, principalId: string) =>
  own(state.notes.members, principalId);

/**
 * Who may do what with review assignments. The feature never consults the application's policy,
 * so this repeats its membership gate.
 *
 * - A peer application, as its service principal, only works on what was sent to it.
 * - Editors plan, read and review; every member works on what was sent to them.
 * - A run acting for a member works, and reads only for an editor: the trigger loop reads the
 *   journal that way, and a run is scoped further to the assignment it was started on.
 */
export const reviewAccess = (state: NotesAssignmentsRoot): AssignmentAccess => ({
  allows(context, action) {
    if (context.peer) return context.peer.subject === undefined && action === 'work';
    const role = roleOf(state, context.principalId);
    if (!role) return false;
    if (isDelegated(context)) return action === 'work' || (action === 'read' && role === 'editor');
    if (role === 'editor') return action !== 'integrate';
    return action === 'work';
  },
});

/** Members list who can take a review. */
const reviewsPolicy = definePolicy<NotesAssignmentsRoot, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: { [reviewOperations.assigneeList.id]: 'open' },
  events: {},
});

/** The route for the note-reviews module. It selects the whole state to read the members. */
export const reviewsRoute: AuthorizationRoute<NotesAssignmentsRoot> = {
  module: noteReviewsModule,
  resourceTypes: [],
  select: (state) => state,
  port: reviewsPolicy as AuthorizationPort<unknown>,
};
