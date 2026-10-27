import { z } from 'zod';
import { operation } from './operation';
import { captureSchema, nodeSchema, proposedFieldSchema, recordId, timestamp } from './schemas';

const read = { action: 'read', resourceType: 'AssignmentReport' };
const review = { action: 'review', resourceType: 'AssignmentReport' };

/** Where the reading of a capture stands, from its latest extraction assignment. */
export const readingStatus = z.enum(['reading', 'proposed', 'accepted', 'refused', 'withdrawn']);

/** A capture: one survey report with its node and how its reading stands. */
export const captureItemSchema = z.strictObject({
  id: z.string(),
  assignmentId: z.string(),
  nodeId: z.string().optional(),
  ...captureSchema.shape,
  reportedBy: z.string(),
  reportedAt: timestamp,
  review: z.enum(['new', 'accepted', 'discarded']),
  reason: z.string().optional(),
  reading: readingStatus.optional(),
  /** A proposed value is below the attention threshold. */
  attention: z.boolean(),
});
export const readingSchema = z.strictObject({
  assignmentId: z.string(),
  status: readingStatus,
  /** Whom the reading was sent to: the model, or a person. */
  assignee: z.string().optional(),
  reportId: z.string().optional(),
  model: z.string().optional(),
  fields: z.array(z.strictObject({ ...proposedFieldSchema.shape, attention: z.boolean() })),
  rejection: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});
export const captureDetailSchema = z.strictObject({
  ...captureItemSchema.shape,
  accepted: z.record(z.string(), z.string()).optional(),
  reviewedBy: z.string().optional(),
  node: nodeSchema.optional(),
  extraction: readingSchema.optional(),
});

export const assigneeOptionSchema = z.strictObject({
  type: z.enum(['person', 'target']),
  id: z.string().min(1).max(128),
  label: z.string().max(200),
});

/**
 * Captures are survey reports; these reads join each with its node and its reading for review.
 * Linking and extracting in one step, and the assignees a planner picks from, are the survey's.
 */
export const captureOperations = {
  captureList: operation('capture.list', 'query', {
    input: z.strictObject({
      assignmentId: recordId.optional(),
      nodeId: recordId.optional(),
      review: z.enum(['new', 'accepted', 'discarded']).optional(),
      unlinked: z.boolean().optional(),
    }),
    output: z.strictObject({ items: z.array(captureItemSchema) }),
    permission: read,
    description:
      'Captures, newest first, filtered by assignment, node, review state, or unlinked (taken without a node). The review queue is review new.',
    dependencies: ['assignment-report', 'assignment'],
  }),
  captureGet: operation('capture.get', 'query', {
    input: z.strictObject({ id: recordId }),
    output: captureDetailSchema,
    permission: read,
    description:
      'One capture with its node and its latest reading: each value read with its confidence, the photo region it was read from, and attention set where confidence is low.',
    dependencies: ['assignment-report', 'assignment', 'node'],
  }),
  linkAndExtract: operation('capture.link-and-extract', 'command', {
    input: z.strictObject({ id: recordId, nodeId: recordId }),
    output: z.strictObject({
      capture: captureItemSchema,
      extraction: z.strictObject({ id: z.string() }),
    }),
    permission: review,
    description:
      'Link a capture to a node and send it to the model to read, in one step: both happen or neither does. Refused as a whole when either one would be.',
    dependencies: ['assignment-report', 'assignment'],
    invokes: ['assignment.report.link', 'assignment.extraction.create'],
  }),
  assigneeList: operation('survey.assignee.list', 'query', {
    input: z.strictObject({}),
    output: z.strictObject({ items: z.array(assigneeOptionSchema) }),
    permission: { action: 'read', resourceType: 'Assignment' },
    description:
      'Who can take survey work here besides paired devices (link.device.list): the members, and the model for extractions.',
    dependencies: [],
  }),
} as const;
