import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { approvalOperations } from '@agent-native/contracts';
import type { Role } from '@agent-native/sample-notes/server';
import { noteTitlesModule } from './contracts';
import type { NotesAgentsRoot } from './domain';

type Rule = OperationRule<NotesAgentsRoot, Role>;
const roleOf = (state: NotesAgentsRoot, principalId: string) =>
  own(state.notes.members, principalId);
const member: Rule = { allow: ({ state, context }) => !!roleOf(state, context.principalId) };
const editor: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Any member may request approval. Approving needs a person, and also passes `note.update`'s own
 * rule as the approver, so a viewer's approval is refused there. Rejecting and expiring need an
 * editor, who could have made the change.
 */
const titlesPolicy = definePolicy<NotesAgentsRoot, Role>({
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    [approvalOperations.approvalRequest.id]: member,
    [approvalOperations.approvalApprove.id]: { ...member, person: true },
    [approvalOperations.approvalReject.id]: { ...editor, person: true },
    [approvalOperations.approvalExpire.id]: editor,
    [approvalOperations.approvalList.id]: 'open',
    [approvalOperations.approvalGet.id]: 'open',
  },
  events: { 'approval-request': () => true },
});

/** The route for the note-titles module. It selects the whole state to read the notes members. */
export const titlesRoute: AuthorizationRoute<NotesAgentsRoot> = {
  module: noteTitlesModule,
  resourceTypes: ['approval-request'],
  select: (state) => state,
  port: titlesPolicy as AuthorizationPort<unknown>,
};
