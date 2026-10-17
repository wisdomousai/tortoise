import { z } from 'zod';
import { defineModule, defineTarget, rejectionSchema } from '@agent-native/contracts';
import { operation } from '@agent-native/asset-survey/contracts/operation';
import {
  captureInputSchema,
  fieldAssignmentSchema,
  fieldNodeSchema,
  photoLimits,
  recordId,
} from '@agent-native/asset-survey/contracts/schemas';

/** How a record stands with the hub: waiting in the outbox, taken, or refused with a reason. */
export const hubSync = z.enum(['pending', 'accepted', 'rejected']);

/**
 * The paired hub as a target. Captures and returns go out through the outbox to the hub's own
 * commands (`capture.ingest`, `assignment.return`), and the hub's `assignment.feed` brings the
 * assignments dispatched to this device with their structure slices.
 */
export const hubTarget = defineTarget({
  target: 'hub',
  resourceType: 'HubSync',
  operations: { settle: 'field.hub.settle', sync: 'field.hub.sync', status: 'field.hub.status' },
  settles: ['capture', 'assignment'],
  feed: { item: fieldAssignmentSchema, max: 50, changes: ['assignment'] },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    settle: 'Integration principal only: record whether the hub took a capture or a return.',
    sync: 'Integration principal only: apply the assignments the hub sent to this device.',
    status: 'Records waiting for the hub, taken and refused, and when assignments last arrived.',
  },
});

const fieldAssignment = z.strictObject({
  id: recordId,
  title: z.string(),
  kinds: fieldAssignmentSchema.shape.kinds,
  note: z.string().optional(),
  nodes: z.number().int(),
  captures: z.number().int(),
  /** Done in the field: returned here or by the hub. */
  returned: z.boolean(),
  returnSync: hubSync.optional(),
});
const fieldCapture = z.strictObject({
  ...captureInputSchema.shape,
  sync: hubSync,
  rejection: rejectionSchema.optional(),
});

/** The field device's own operations: browse its assignments, capture, hand back. */
export const fieldOperations = {
  assignmentList: operation('field.assignment.list', 'query', {
    input: z.strictObject({}),
    output: z.strictObject({ items: z.array(fieldAssignment) }),
    permission: { action: 'read', resourceType: 'Assignment' },
    description: 'The assignments the hub sent to this device, with how many captures each has.',
    dependencies: ['assignment', 'capture'],
  }),
  nodeList: operation('field.node.list', 'query', {
    input: z.strictObject({ assignmentId: recordId, q: z.string().max(128).optional() }),
    output: z.strictObject({
      items: z.array(
        z.strictObject({
          ...fieldNodeSchema.shape,
          depth: z.number().int(),
          captures: z.number().int(),
        }),
      ),
    }),
    permission: { action: 'read', resourceType: 'Assignment' },
    description:
      'The structure of one assignment depth first, or the nodes whose designation starts with q (spaces and case ignored) or whose name contains it. A scanned tag is searched the same way.',
    dependencies: ['assignment', 'capture'],
  }),
  captureRecord: operation('field.capture.record', 'command', {
    input: captureInputSchema,
    output: fieldCapture,
    permission: { action: 'capture', resourceType: 'Capture' },
    description:
      'Record a capture with its photos (taken first and stored as blobs) on a node of an open assignment, or unplaced when the node is unknown. It goes to the hub as soon as the device reaches it.',
    dependencies: ['capture'],
    forwards: 'hub',
    blobs: photoLimits,
  }),
  captureList: operation('field.capture.list', 'query', {
    input: z.strictObject({ assignmentId: recordId.optional(), unplaced: z.boolean().optional() }),
    output: z.strictObject({ items: z.array(fieldCapture) }),
    permission: { action: 'read', resourceType: 'Capture' },
    description: 'Captures on this device, newest first, with whether the hub has taken each.',
    dependencies: ['capture'],
  }),
  assignmentReturn: operation('field.assignment.return', 'command', {
    input: z.strictObject({ id: recordId }),
    output: fieldAssignment,
    permission: { action: 'return', resourceType: 'Assignment' },
    description:
      'Finish the field work on an assignment. No further captures are taken for it, and the hub is told after the captures already waiting.',
    dependencies: ['assignment'],
    forwards: 'hub',
  }),
  status: hubTarget.status,
  sync: hubTarget.sync,
  settle: hubTarget.settle,
} as const;

export const fieldModule = defineModule({
  id: 'survey-field',
  capabilities: [
    fieldOperations.assignmentList,
    fieldOperations.nodeList,
    fieldOperations.captureRecord,
    fieldOperations.captureList,
    fieldOperations.assignmentReturn,
    ...hubTarget.capabilities,
  ],
});
