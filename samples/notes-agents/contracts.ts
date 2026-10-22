import { approvalOperations, defineAgent, defineModule } from '@agent-native/contracts';

/**
 * Suggests a title for a note that has none. It may read notes and ask for `note.update`; a
 * person approves or rejects each request, and approving runs the update as that person.
 */
export const titler = defineAgent({
  id: 'note.titler',
  title: 'Note titler',
  instructions:
    'Find notes with an empty title. Read each with note.get, then request approval for note.update with a short title taken from its text (resource note:<id>, with the note revision you read as baseRevisions). Never request approval to change the text.',
  operations: ['note.list', 'note.get', 'note.update', 'approval.list'],
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 6, toolCalls: 20, wallTimeMs: 120_000 },
});

/** Approval requests for note changes, and the titler agent. Browser-safe. */
export const noteTitlesModule = defineModule({
  id: 'note-titles',
  capabilities: Object.values(approvalOperations),
  agents: [titler],
});
