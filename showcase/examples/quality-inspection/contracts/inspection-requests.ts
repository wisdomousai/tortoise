import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
} from '@agent-native/contracts';
import { id, timestamp } from './schemas';

export const inspectionOutcomeSchema = z.enum(['accepted', 'rejected']);

/**
 * Goods that another application received and sent for incoming inspection. `requestedBy` is
 * the requesting peer's principal; the feed returns each peer only its own requests.
 */
export const inspectionRequestSchema = z.strictObject({
  id,
  /** The requesting application's line, which the outcome goes back to. */
  delivery: id,
  purchaseOrder: z.string().min(1).max(40),
  supplier: z.string().min(1).max(200),
  sku: z.string().min(1).max(40),
  description: z.string().max(200),
  quantity: z.number().int().nonnegative(),
  requestedBy: z.string().min(1).max(160),
  status: z.enum(['open', 'closed']),
  outcome: inspectionOutcomeSchema.optional(),
  note: z.string().max(500).optional(),
  requestedAt: timestamp,
  closedAt: timestamp.optional(),
  closedBy: z.string().optional(),
  /** Position in the feed of closed requests. */
  seq: z.number().int().min(1).optional(),
});
export type InspectionRequest = z.output<typeof inspectionRequestSchema>;

/** One closed inspection request as the feed returns it to the application that created it. */
export const closedInspectionRequestSchema = z.strictObject({
  id,
  delivery: id,
  outcome: inspectionOutcomeSchema,
  note: z.string().max(500).optional(),
  closedAt: timestamp,
});
export type ClosedInspectionRequest = z.output<typeof closedInspectionRequestSchema>;

export const inspectionRequests = defineCollection({
  type: 'inspection-request',
  resourceType: 'InspectionRequest',
  item: inspectionRequestSchema,
  label: { one: 'Inspection request', many: 'Inspection requests' },
});

/** Inspection requests created by a peer, closed by inspectors, and the feed of their outcomes. */
export const inspectionRequestOperations = {
  inspectionRequestList: collectionList(inspectionRequests, {
    id: 'inspection.request',
    filters: ['status'],
    search: true,
    description:
      'List inspection requests other applications sent for incoming inspection, open first. Visible to people who capture at some plant. search matches purchase order, supplier, SKU and description.',
  }),
  inspectionRequestGet: collectionGet(inspectionRequests, {
    id: 'inspection.request',
    description: 'Read one inspection request by id, with its outcome once closed.',
  }),
  inspectionRequestCreate: defineCapability({
    id: 'inspection.request.create',
    kind: 'command',
    description:
      'Peer applications only: request incoming inspection of received goods. An open request for the same delivery from the same peer is returned instead of a second one.',
    input: jsonSchema(
      inspectionRequestSchema.pick({
        delivery: true,
        purchaseOrder: true,
        supplier: true,
        sku: true,
        description: true,
        quantity: true,
      }),
    ),
    output: jsonSchema(z.strictObject({ id })),
    permission: { action: 'create', resourceType: 'InspectionRequest' },
    dependencies: ['inspection-request'],
    ui: { exception: 'called by a peer application through the peer link' },
  }),
  inspectionRequestClose: defineCapability({
    id: 'inspection.request.close',
    kind: 'command',
    description:
      'Close an open inspection request with the incoming inspection outcome, accepted or rejected, and an optional note. Inspectors and supervisors at some plant; a closed request conflicts. The requesting application reads the outcome from its feed.',
    input: jsonSchema(
      z.strictObject({
        id,
        outcome: inspectionOutcomeSchema,
        note: inspectionRequestSchema.shape.note,
      }),
    ),
    output: jsonSchema(inspectionRequestSchema),
    permission: { action: 'close', resourceType: 'InspectionRequest' },
    dependencies: ['inspection-request'],
    ui: { binding: 'inspection.request.close' },
  }),
  inspectionRequestFeed: defineCapability({
    id: 'inspection.request.feed',
    kind: 'query',
    description:
      'Peer applications only: the outcomes of the inspection requests the calling peer created, closed after cursor, oldest first.',
    input: jsonSchema(z.strictObject({ cursor: z.string().max(32).optional() })),
    output: jsonSchema(
      z.strictObject({
        items: z.array(closedInspectionRequestSchema).max(100),
        cursor: z.string(),
        more: z.boolean().optional(),
      }),
    ),
    permission: { action: 'read', resourceType: 'InspectionRequest' },
    dependencies: ['inspection-request'],
    ui: { exception: 'read by a peer application through the peer link' },
  }),
} as const;
