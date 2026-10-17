import { z } from 'zod';
import { operation } from './operation';
import {
  assignmentSchema,
  captureDetailSchema,
  captureInputSchema,
  captureKind,
  captureSchema,
  fieldAssignmentSchema,
  photoLimits,
  recordId,
  reviewStatus,
  text,
} from './schemas';

/**
 * Assignments sent to field devices and the captures that come back. `assignment.feed`,
 * `assignment.return` and `capture.ingest` are a paired field device's operations; the hub's
 * people dispatch and review.
 */
export const fieldOperations = {
  assignmentCreate: operation('assignment.create', 'command', {
    input: z.strictObject({
      title: text(200),
      roots: z.array(recordId).min(1).max(50),
      kinds: z.array(captureKind).min(1),
      note: z.string().max(2000).optional(),
    }),
    output: assignmentSchema,
    permission: { action: 'plan', resourceType: 'Assignment' },
    description:
      'Plan field work: the subtrees to visit (roots) and the kinds of capture wanted there, such as nameplates of every breaker under =G1. Starts as a draft.',
    dependencies: ['assignment'],
  }),
  assignmentDispatch: operation('assignment.dispatch', 'command', {
    input: z.strictObject({ id: recordId, deviceId: z.string().min(1).max(64) }),
    output: assignmentSchema,
    permission: { action: 'plan', resourceType: 'Assignment' },
    description:
      'Send a draft assignment to one paired field device (link.device.list names them). The device receives it with its structure slice at its next sync.',
    dependencies: ['assignment'],
  }),
  assignmentList: operation('assignment.list', 'query', {
    input: z.strictObject({}),
    output: z.strictObject({ items: z.array(assignmentSchema) }),
    permission: { action: 'read', resourceType: 'Assignment' },
    description:
      'Every assignment with its stage: draft, dispatched, in-field once captures arrive, returned when the device is done, processed when every capture is reviewed, filed when every node it covers that has attributes is filed.',
    dependencies: ['assignment', 'capture', 'filing'],
  }),
  assignmentFeed: operation('assignment.feed', 'query', {
    input: z.strictObject({ cursor: z.string().max(64).optional() }),
    output: z.strictObject({
      items: z.array(fieldAssignmentSchema),
      cursor: z.string(),
      more: z.boolean(),
    }),
    permission: { action: 'sync', resourceType: 'Assignment' },
    description:
      'Field device only: the assignments dispatched to the calling device with their structure slices. Returns nothing new while cursor is current.',
    dependencies: ['assignment', 'node'],
    exception: 'read by the field app through its hub sync, not by a hub screen',
  }),
  assignmentReturn: operation('assignment.return', 'command', {
    input: z.strictObject({ id: recordId }),
    output: assignmentSchema,
    permission: { action: 'return', resourceType: 'Assignment' },
    description:
      'Mark field work on an assignment done. The field device returns its own assignments; a manager may return one for a lost device.',
    dependencies: ['assignment'],
  }),
  captureIngest: operation('capture.ingest', 'command', {
    input: captureInputSchema,
    output: z.strictObject({ id: recordId }),
    permission: { action: 'ingest', resourceType: 'Capture' },
    description:
      'Field device only: hand over one capture with its photos (uploaded first as blobs). The capture ID comes from the device, so delivering it again is harmless; a different capture under the same ID conflicts.',
    dependencies: ['capture', 'assignment'],
    blobs: photoLimits,
    exception: 'sent by the field app through its outbox, not by a hub screen',
  }),
  captureList: operation('capture.list', 'query', {
    input: z.strictObject({
      assignmentId: recordId.optional(),
      nodeId: recordId.optional(),
      review: reviewStatus.optional(),
      unplaced: z.boolean().optional(),
    }),
    output: z.strictObject({ items: z.array(captureSchema) }),
    permission: { action: 'read', resourceType: 'Capture' },
    description:
      'Captures, newest first, filtered by assignment, node, review status, or unplaced (taken without a node). The review queue is review new.',
    dependencies: ['capture', 'extraction'],
  }),
  captureGet: operation('capture.get', 'query', {
    input: z.strictObject({ id: recordId }),
    output: captureDetailSchema,
    permission: { action: 'read', resourceType: 'Capture' },
    description:
      'One capture with its node and its extraction: each proposed value with its confidence, the photo region it was read from, and attention set where confidence is low.',
    dependencies: ['capture', 'extraction', 'node'],
  }),
  capturePlace: operation('capture.place', 'command', {
    input: z.strictObject({ id: recordId, nodeId: recordId }),
    output: captureSchema,
    permission: { action: 'review', resourceType: 'Capture' },
    description:
      'Place a capture on a node: an unplaced capture, or one the device put on the wrong node. Accepted attributes stay with the node they were accepted on.',
    dependencies: ['capture'],
  }),
  captureDiscard: operation('capture.discard', 'command', {
    input: z.strictObject({ id: recordId, reason: text(500) }),
    output: captureSchema,
    permission: { action: 'review', resourceType: 'Capture' },
    description:
      'Discard a capture that is unusable (blurred, wrong object, duplicate) with the reason. Its photos stay readable for the record.',
    dependencies: ['capture'],
  }),
} as const;
