import {
  definePolicy,
  own,
  type AuthorizationPort,
  type AuthorizationRoute,
  type OperationRule,
} from '@agent-native/runtime';
import { worklistRules } from '@agent-native/assignments/server';
import type { Role } from '@agent-native/sample-notes/server';
import { worklist, worklistOperations } from './contracts';
import { INTEGRATION_PRINCIPAL, type NotesWorklistRoot } from './domain';

type Rule = OperationRule<NotesWorklistRoot, Role>;
const roleOf = (state: NotesWorklistRoot, principalId: string) =>
  own(state.notes.members, principalId);
const member = (state: NotesWorklistRoot, context: { principalId: string }) =>
  roleOf(state, context.principalId) !== undefined;
const editor: Rule = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'editor',
};

/**
 * Members see the worklist; editors report and mark work done. The integration principal only
 * settles deliveries and applies the reviews notes-assignments sends, and nobody else may.
 */
const worklistPolicy = definePolicy<NotesWorklistRoot, Role>({
  integrations: [
    {
      is: (_state, principalId) => principalId === INTEGRATION_PRINCIPAL,
      operations: worklist.target.integrationOperations,
    },
  ],
  caller: { allow: member },
  operations: {
    ...worklistRules(worklist),
    [worklistOperations.reviewReport.id]: editor,
    [worklistOperations.complete.id]: editor,
  },
  events: {
    'worklist-assignment': (_id, state, context) => member(state, context),
    'worklist-report': (_id, state, context) => member(state, context),
    sync: (_id, state, context) => member(state, context),
  },
});

/** The route for the worklist module. It selects the whole state to read the notes members. */
export const worklistRoute: AuthorizationRoute<NotesWorklistRoot> = {
  module: worklist.module,
  resourceTypes: ['worklist-assignment', 'worklist-report', 'sync'],
  select: (state) => state,
  port: worklistPolicy as AuthorizationPort<unknown>,
};
