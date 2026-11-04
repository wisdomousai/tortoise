import { z } from 'zod';
import {
  blobRefSchema,
  defineAgent,
  defineCapability,
  defineHostComponent,
  defineModule,
  definePeerApi,
  jsonSchema,
  recordKeySchema,
} from '@tortoise/contracts';
import { defineAssignmentKind, defineAssignments } from '../src';

/**
 * A review of notes and their attached text: a person, an agent or the checker service reads them
 * and gives a verdict.
 */
export const review = defineAssignmentKind({
  id: 'review',
  title: 'Review',
  description: 'Read the notes in the brief and give one verdict per note.',
  scope: z.strictObject({
    notes: z.array(recordKeySchema).min(1).max(20),
    attachments: z.array(blobRefSchema).max(4).optional(),
  }),
  brief: z.strictObject({
    notes: z.array(z.strictObject({ id: recordKeySchema, title: z.string(), body: z.string() })),
    attachments: z.array(blobRefSchema).max(4).optional(),
  }),
  report: z.strictObject({
    verdict: z.enum(['keep', 'revise']),
    comment: z.string().max(2000),
  }),
  accept: z.strictObject({ comment: z.string().max(2000).optional() }),
  subject: 'note',
  blobs: { brief: { maxBytes: 100_000, mediaTypes: ['text/plain'] } },
  assigneeTypes: ['person', 'agent', 'target'],
  target: 'checker',
  invokes: ['notes.note.update'],
  changes: ['note'],
});

/** Field work: a device or a peer photographs the nodes in scope. */
export const survey = defineAssignmentKind({
  id: 'field-survey',
  title: 'Field survey',
  description: 'Photograph each node in the brief and note its condition.',
  scope: z.strictObject({ roots: z.array(recordKeySchema).min(1).max(10) }),
  brief: z.strictObject({
    nodes: z.array(z.strictObject({ id: recordKeySchema, designation: z.string() })),
  }),
  report: z.strictObject({
    photos: z.array(blobRefSchema).max(8),
    condition: z.enum(['good', 'fair', 'poor']).optional(),
  }),
  subject: 'node',
  blobs: { report: { maxBytes: 8_000_000, mediaTypes: ['image/jpeg'] } },
  assigneeTypes: ['device', 'peer', 'person'],
});

export const assignments = defineAssignments({ kinds: [review, survey] });

/** The destination of the checker service, the review kind's assignment target. */
export const checker = defineHostComponent({
  id: 'checker',
  description: 'The checker service, which reviews notes.',
  requirements: {
    network: [
      {
        id: 'checker-api',
        purpose: 'Offer notes for review and read the verdicts.',
        direction: 'outbound',
        scope: 'site',
        protocol: 'https',
        targets: ['assignment-checker'],
        dataClasses: ['note'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
});

/** What the issuer publishes to peers and devices: the assignee operations. */
export const issuerApi = definePeerApi({
  application: 'assignments-fixture',
  commands: assignments.assignees.peer.commands,
  queries: assignments.assignees.peer.queries,
});

/** The application command the review kind's accept hook calls. */
export const noteUpdate = defineCapability({
  id: 'notes.note.update',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: recordKeySchema, comment: z.string().max(2000) })),
  output: jsonSchema(z.strictObject({ id: recordKeySchema, comments: z.array(z.string()) })),
  permission: { action: 'write', resourceType: 'Note' },
  dependencies: ['note'],
  ui: { exception: 'test fixture' },
});

/**
 * An agent that takes review assignments: a run scoped to one assignment reads it, reports on
 * its notes and completes it. `notes.other` may call the same operations but is not the assignee.
 */
const reviewerOf = (id: string) =>
  defineAgent({
    id,
    title: 'Note reviewer',
    instructions: 'Read the notes in the brief, report one verdict per note, then complete.',
    operations: ['assignment.get', 'assignment.review.report', 'assignment.complete'],
    resourceTypes: ['assignment'],
    creates: ['assignment-report'],
    model: 'any',
    output: 'direct',
    budgets: { turns: 10, toolCalls: 10, wallTimeMs: 60_000 },
  });
export const reviewer = reviewerOf('notes.reviewer');
export const notesModule = defineModule({
  id: 'notes',
  capabilities: [noteUpdate],
  agents: [reviewer, reviewerOf('notes.other')],
});
