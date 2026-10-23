import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  deliveryShape,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** Why a counted quantity differs from the advance shipping notice. */
export const reasonSchema = z.enum(['short', 'over', 'damaged', 'wrong-item']);

/** One line of an advance shipping notice from the ERP, and what was counted against it. */
export const deliverySchema = z.strictObject({
  id: recordKeySchema,
  purchaseOrder: z.string().min(1).max(40),
  supplier: z.string().min(1).max(200),
  sku: z.string().min(1).max(40),
  description: z.string().max(200),
  expected: z.number().int().nonnegative(),
  /** The ERP asks for incoming inspection: posting the line announces it to quality inspection. */
  inspect: z.boolean().optional(),
  counted: z.number().int().nonnegative().optional(),
  reason: reasonSchema.optional(),
  note: z.string().max(500).optional(),
  /** `expected` until counted; `posted` once the goods receipt went to the ERP. */
  status: z.enum(['expected', 'counted', 'posted']),
  /** The goods receipt sent to the ERP and its outcome. */
  posting: z.strictObject({ effectId: z.string(), ...deliveryShape }).optional(),
  /**
   * The arrival announced to quality inspection (`sorRef` is its ID there), and its outcome once
   * an inspector closed it.
   */
  inspection: z
    .strictObject({
      effectId: z.string(),
      ...deliveryShape,
      outcome: z.enum(['accepted', 'rejected']).optional(),
      note: z.string().max(500).optional(),
    })
    .optional(),
  arrivedAt: z.number().int().nonnegative(),
});
export type Delivery = z.output<typeof deliverySchema>;

export const deliveries = defineCollection({
  type: 'delivery',
  resourceType: 'Delivery',
  item: deliverySchema,
  label: { one: 'Delivery', many: 'Deliveries' },
});

const write = { action: 'write', resourceType: 'Delivery' };

/** Reads of deliveries, and counting and classifying them. Browser-safe. */
export const deliveryOperations = {
  deliveryList: collectionList(deliveries, {
    id: 'delivery',
    description:
      'List delivery lines, newest first. Filter by status (expected, counted, posted) or search the purchase order, supplier, SKU and description.',
    filters: ['status'],
    search: true,
  }),
  deliveryGet: collectionGet(deliveries, {
    id: 'delivery',
    description:
      'Read one delivery line by id. Use its revision as delivery:<id> in expectedRevisions.',
  }),
  deliveryReceive: defineCapability({
    id: 'delivery.receive',
    kind: 'command',
    description:
      'Record the quantity counted for a delivery line. A count equal to the expected quantity clears the discrepancy reason. Editors only; a posted line conflicts.',
    input: jsonSchema(
      z.strictObject({ id: recordKeySchema, counted: deliverySchema.shape.expected }),
    ),
    output: jsonSchema(deliverySchema),
    permission: write,
    dependencies: ['delivery'],
    ui: { binding: 'delivery.receive' },
  }),
  deliveryClassify: defineCapability({
    id: 'delivery.classify',
    kind: 'command',
    description:
      'Give the reason a counted quantity differs from the expected one, with an optional note. Editors only; a line without a discrepancy, or already posted, conflicts.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        reason: reasonSchema,
        note: deliverySchema.shape.note,
      }),
    ),
    output: jsonSchema(deliverySchema),
    permission: write,
    dependencies: ['delivery'],
    ui: { binding: 'delivery.classify' },
  }),
} as const;
