import { z } from 'zod';
import {
  defineModule,
  definePeerTarget,
  effectOutcomeSchema,
  rejectionSchema,
} from '@agent-native/contracts';
import { fieldOperations as hubOperations } from '@agent-native/asset-survey/contracts/captures';
import { fieldSurface } from '@agent-native/asset-survey/contracts/peer';
import { operation } from '@agent-native/asset-survey/contracts/operation';
import {
  captureInputSchema,
  fieldAssignmentSchema,
  fieldNodeSchema,
  photoLimits,
  recordId,
} from '@agent-native/asset-survey/contracts/schemas';
import { fieldOs } from './os';

/** How a record stands with the hub: waiting in the outbox, taken, or refused with a reason. */
export const hubSync = z.enum(['pending', 'accepted', 'rejected']);

/**
 * The paired hub as a peer target, through the field surface it publishes. Captures and returns
 * go out through the outbox to the hub's own commands (`capture.ingest`, `assignment.return`),
 * with payloads parsed by those commands' input schemas, and the hub's `assignment.feed` brings
 * the assignments dispatched to this device with their structure slices. Hub-link declares the
 * `hub` destination and carries the device credential, so the manifest lists no peer component.
 */
export const hubTarget = definePeerTarget({
  target: 'hub',
  resourceType: 'HubSync',
  surface: fieldSurface,
  operations: { settle: 'field.hub.settle', sync: 'field.hub.sync', status: 'field.hub.status' },
  settles: ['capture', 'assignment'],
  feed: {
    query: hubOperations.assignmentFeed,
    item: fieldAssignmentSchema,
    max: 50,
    changes: ['assignment'],
  },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    settle: 'Integration principal only: record whether the hub took a capture or a return.',
    sync: 'Integration principal only: apply the assignments the hub sent to this device.',
    status: 'Records waiting for the hub, taken and refused, and when assignments last arrived.',
  },
  destination: {
    id: 'hub',
    purpose: 'Deliver field records and their photos to the hub, and read assignments.',
    dataClasses: ['field-record', 'photo'],
    availability: 'optional',
    offline: 'queue',
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
  tagGet: operation('field.tag.get', 'query', {
    input: z.strictObject({ id: z.string().regex(/^[^\s:]{1,128}$/) }),
    output: z.strictObject({
      id: z.string(),
      matches: z.array(
        z.strictObject({
          assignmentId: recordId,
          nodeId: recordId,
          designation: fieldNodeSchema.shape.designation,
          name: fieldNodeSchema.shape.name,
        }),
      ),
    }),
    permission: { action: 'read', resourceType: 'Assignment' },
    description:
      'Where an asset tag is in the open assignments: the nodes it finds as a scan does, by designation prefix with spaces and case ignored, or by name. An intent from another app opens tag:<tag> through this query.',
    dependencies: ['assignment'],
    exception:
      'Read when an OS request opens tag:<tag>, to choose the capture or search screen that shows it.',
  }),
  noticesSettle: operation('assignment-notices.effect.settle', 'command', {
    input: z.strictObject({
      effectId: z.string().min(1).max(128),
      outcome: effectOutcomeSchema,
      fence: z.number().int().min(1).optional(),
    }),
    output: z.strictObject({}),
    permission: { action: 'settle', resourceType: 'AssignmentNotice' },
    description:
      'Notification dispatcher only: record whether the device showed the notice of a new assignment.',
    dependencies: ['assignment'],
    exception: 'Called by the notification dispatcher once the device showed the notice.',
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
    fieldOperations.tagGet,
    fieldOperations.noticesSettle,
    ...hubTarget.capabilities,
  ],
  os: fieldOs,
});
