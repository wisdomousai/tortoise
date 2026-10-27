import { z } from 'zod';
import { blobRefSchema } from '@agent-native/contracts';
import { defineAssignmentKind, defineAssignments } from '@agent-native/assignments';
import {
  captureKind,
  captureSchema,
  fieldNodeSchema,
  photoLimits,
  proposedFieldSchema,
  recordId,
  valuesSchema,
} from './schemas';

/**
 * Field work: whoever takes it visits the subtrees in scope and reports one capture at a time,
 * each about the node it shows, or about none when the node is unknown. Accepting a capture
 * writes the reviewer's values onto its node.
 */
export const survey = defineAssignmentKind({
  id: 'survey',
  title: 'Survey',
  description:
    'Visit the nodes in the brief and photograph the kinds of capture it asks for, one report per capture.',
  scope: z.strictObject({
    roots: z.array(recordId).min(1).max(50),
    kinds: z.array(captureKind).min(1).max(5),
  }),
  brief: z.strictObject({
    kinds: z.array(captureKind),
    nodes: z.array(fieldNodeSchema).max(2000),
  }),
  report: captureSchema,
  accept: z.strictObject({ values: valuesSchema }),
  subject: 'node',
  blobs: { report: photoLimits },
  assigneeTypes: ['device', 'person'],
  changes: ['node'],
});

/**
 * Reading one capture's photos: the model takes it through the outbox and reports through its
 * feed, or a person types the values. Accepting the reading accepts the capture with the
 * reviewer's corrected values.
 */
export const extraction = defineAssignmentKind({
  id: 'extraction',
  title: 'Extraction',
  description:
    'Read the values on the photos of one capture, such as manufacturer, type, serial, year and ratings: one report with every value, how sure you are and where on which photo you read it.',
  scope: z.strictObject({ reportId: recordId }),
  brief: z.strictObject({
    reportId: recordId,
    kind: captureKind,
    photos: z.array(blobRefSchema).min(1).max(8),
  }),
  report: z.strictObject({
    model: z.string().min(1).max(120),
    fields: z.array(proposedFieldSchema).max(40),
  }),
  accept: z.strictObject({ values: valuesSchema }),
  blobs: { brief: photoLimits },
  assigneeTypes: ['target', 'person'],
  target: 'model',
  invokes: ['assignment.survey.accept'],
  changes: ['node'],
});

export const assignments = defineAssignments({ kinds: [survey, extraction] });
/** The generated operations, flat, so screens bind them by name. */
export const assignmentOperations = assignments.operations;
/** The model's assignment target: offers go out through the outbox, readings come back on its feed. */
export const modelTarget = assignments.targets.model!;
/** Linking a capture to a node: present because the survey kind has a subject. */
export const reportLink = assignmentOperations.reportLink!;

/** Values read below this confidence are flagged for attention. */
export const ATTENTION_BELOW = 0.8;
