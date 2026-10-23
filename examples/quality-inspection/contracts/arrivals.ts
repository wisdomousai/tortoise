import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
} from '@agent-native/contracts';
import { id, timestamp } from './schemas';

export const arrivalOutcomeSchema = z.enum(['accepted', 'rejected']);

/**
 * Goods that another application received and announced for incoming inspection. `from` is the
 * announcing peer's principal; the feed answers each peer only its own arrivals.
 */
export const arrivalSchema = z.strictObject({
  id,
  /** The announcing application's line, which the outcome goes back to. */
  delivery: id,
  purchaseOrder: z.string().min(1).max(40),
  supplier: z.string().min(1).max(200),
  sku: z.string().min(1).max(40),
  description: z.string().max(200),
  quantity: z.number().int().nonnegative(),
  from: z.string().min(1).max(160),
  status: z.enum(['open', 'closed']),
  outcome: arrivalOutcomeSchema.optional(),
  note: z.string().max(500).optional(),
  announcedAt: timestamp,
  closedAt: timestamp.optional(),
  closedBy: z.string().optional(),
  /** Position in the feed of closed arrivals. */
  seq: z.number().int().min(1).optional(),
});
export type Arrival = z.output<typeof arrivalSchema>;

/** One closed arrival as the feed answers it to the application that announced it. */
export const arrivalResultSchema = z.strictObject({
  id,
  delivery: id,
  outcome: arrivalOutcomeSchema,
  note: z.string().max(500).optional(),
  closedAt: timestamp,
});
export type ArrivalResult = z.output<typeof arrivalResultSchema>;

export const arrivals = defineCollection({
  type: 'arrival',
  resourceType: 'Arrival',
  item: arrivalSchema,
  label: { one: 'Arrival', many: 'Arrivals' },
});

/** Arrivals announced by a peer, closed by inspectors, and the feed of their outcomes. */
export const arrivalOperations = {
  arrivalList: collectionList(arrivals, {
    id: 'inspection.arrival',
    filters: ['status'],
    search: true,
    description:
      'List arrivals other applications announced for incoming inspection, open first. Visible to people who capture at some plant. search matches purchase order, supplier, SKU and description.',
  }),
  arrivalGet: collectionGet(arrivals, {
    id: 'inspection.arrival',
    description: 'Read one arrival by id, with its outcome once closed.',
  }),
  arrivalAnnounce: defineCapability({
    id: 'inspection.arrival.announce',
    kind: 'command',
    description:
      'Peer applications only: announce received goods for incoming inspection. An open arrival of the same delivery from the same peer is answered instead of a second one.',
    input: jsonSchema(
      arrivalSchema.pick({
        delivery: true,
        purchaseOrder: true,
        supplier: true,
        sku: true,
        description: true,
        quantity: true,
      }),
    ),
    output: jsonSchema(z.strictObject({ id })),
    permission: { action: 'announce', resourceType: 'Arrival' },
    dependencies: ['arrival'],
    ui: { exception: 'called by a peer application through the peer link' },
  }),
  arrivalClose: defineCapability({
    id: 'inspection.arrival.close',
    kind: 'command',
    description:
      'Close an open arrival with the incoming inspection outcome, accepted or rejected, and an optional note. Inspectors and supervisors at some plant; a closed arrival conflicts. The announcing application reads the outcome from its feed.',
    input: jsonSchema(
      z.strictObject({ id, outcome: arrivalOutcomeSchema, note: arrivalSchema.shape.note }),
    ),
    output: jsonSchema(arrivalSchema),
    permission: { action: 'close', resourceType: 'Arrival' },
    dependencies: ['arrival'],
    ui: { binding: 'inspection.arrival.close' },
  }),
  arrivalFeed: defineCapability({
    id: 'inspection.arrival.feed',
    kind: 'query',
    description:
      'Peer applications only: the outcomes of the arrivals the calling peer announced, closed after cursor, oldest first.',
    input: jsonSchema(z.strictObject({ cursor: z.string().max(32).optional() })),
    output: jsonSchema(
      z.strictObject({
        items: z.array(arrivalResultSchema).max(100),
        cursor: z.string(),
        more: z.boolean().optional(),
      }),
    ),
    permission: { action: 'read', resourceType: 'Arrival' },
    dependencies: ['arrival'],
    ui: { exception: 'read by a peer application through the peer link' },
  }),
} as const;
