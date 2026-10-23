import { approvalOperations } from '@agent-native/contracts';
import { defineTrigger } from '@agent-native/automation/contracts';
import type { Job } from '@agent-native/automation/jobs';
import { createAutomationPlugin } from '@agent-native/automation/plugin';
import { noteOperations, type Note } from '@agent-native/sample-notes/server';
import { titleFrom } from './title';

/**
 * When a note is added without a title, request approval to title it with its first line. It
 * runs as the person who enabled it, narrowed to reading a note and requesting approval, so it
 * never changes a note itself. A job, so it needs no model.
 */
export const titleNewNotes = defineTrigger({
  id: 'title-new-notes',
  title: 'Suggest titles for untitled notes',
  on: { event: { resourceType: 'note', operations: [noteOperations.noteAdd.id] } },
  run: {
    job: 'suggest-title',
    operations: [noteOperations.noteGet.id, approvalOperations.approvalRequest.id],
  },
  budgets: { toolCalls: 5, wallTimeMs: 30_000 },
});

export const suggestTitle: Job = async ({ event, query, command }) => {
  if (!event) return;
  const id = event.resource.slice('note:'.length);
  const { data: note } = await query<Note & { revision: number }>(noteOperations.noteGet.id, {
    id,
  });
  const title = titleFrom(note.text);
  if (note.title || !title) return;
  await command(approvalOperations.approvalRequest.id, {
    operation: noteOperations.noteUpdate.id,
    input: { id, title },
    rationale: 'The note has no title; this is the first line of its text.',
    resource: event.resource,
    baseRevisions: { [event.resource]: note.revision },
  });
};

export const createTitleAutomation = (options: { intervalMs?: number } = {}) =>
  createAutomationPlugin({
    triggers: [titleNewNotes],
    jobs: { 'suggest-title': suggestTitle },
    ...(options.intervalMs ? { intervalMs: options.intervalMs } : {}),
  });
