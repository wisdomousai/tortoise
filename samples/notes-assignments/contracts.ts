import { z } from 'zod';
import {
  defineAgent,
  defineCapability,
  defineModule,
  definePeerSurface,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';
import { defineAssignmentKind, defineAssignments } from '@agent-native/assignments';
import { noteOperations, noteSchema } from '@agent-native/sample-notes/contracts';

/**
 * A review of some notes: whoever takes it reads them and gives each a verdict with a comment.
 * Accepting a report adds its comment to the note it is about.
 */
export const review = defineAssignmentKind({
  id: 'review',
  title: 'Note review',
  description: 'Read the notes in the brief and say for each whether to keep it or revise it.',
  scope: z.strictObject({ notes: z.array(recordKeySchema).min(1).max(20) }),
  brief: z.strictObject({
    notes: z.array(
      z.strictObject({
        id: recordKeySchema,
        title: noteSchema.shape.title,
        text: noteSchema.shape.text,
      }),
    ),
  }),
  report: z.strictObject({
    verdict: z.enum(['keep', 'revise']),
    comment: z.string().min(1).max(500),
  }),
  accept: z.strictObject({ comment: z.string().min(1).max(500).optional() }),
  subject: 'note',
  lanes: ['person', 'agent', 'peer'],
  invokes: [noteOperations.noteUpdate.id],
  changes: ['note'],
});

export const assignments = defineAssignments({ kinds: [review] });
/** The generated operations, flat, so screens bind them by name. */
export const assignmentOperations = assignments.operations;

/**
 * Takes review assignments sent to it: a run started on one reads it, reports a verdict per note
 * and marks it done. Its grant is scoped to that assignment and the reports it creates.
 */
export const reviewer = defineAgent({
  id: 'note.reviewer',
  title: 'Note reviewer',
  instructions:
    'You review notes. Read the assignment you were started on with assignment.get. For each note in its brief, call assignment.review.report once, with the report id <assignment id>-<note id>, the note id as subject, verdict keep or revise, and a one-line comment. Then call assignment.complete with the assignment id.',
  operations: [
    assignmentOperations.get.id,
    assignmentOperations.reviewReport.id,
    assignmentOperations.complete.id,
  ],
  resourceTypes: ['assignment'],
  creates: ['assignment-report'],
  model: 'any',
  output: 'direct',
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 120_000 },
});

export const assigneeSchema = z.strictObject({
  type: z.enum(['person', 'agent']),
  id: z.string().min(1).max(128),
  label: z.string().max(200),
});

export const reviewOperations = {
  assigneeList: defineCapability({
    id: 'review.assignee.list',
    kind: 'query',
    description:
      'Who can take a note review here: the members of the workspace and the reviewer agent. Peer applications are listed by the peer link.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(assigneeSchema) })),
    permission: { action: 'read', resourceType: 'Note' },
    dependencies: ['note'],
    ui: { binding: 'review.assignee.list' },
  }),
} as const;

/** Who can take reviews, and the reviewer agent. Browser-safe. */
export const noteReviewsModule = defineModule({
  id: 'note-reviews',
  capabilities: Object.values(reviewOperations),
  agents: [reviewer],
});

/**
 * What another application may call here over the peer link, as its service principal: the
 * review assignments sent to it, its reports on them and its done marks.
 */
export const notesAssignmentsSurface = definePeerSurface({
  application: 'notes-assignments',
  commands: assignments.lanes.peer.commands,
  queries: assignments.lanes.peer.queries,
});
