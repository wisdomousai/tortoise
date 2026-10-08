import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

const count = z.number().int().min(0);

export const webhookStatusSchema = z.strictObject({
  /** Journal cursor up to which notifications were delivered. */
  cursor: count,
  delivered: count,
  failures: count,
  lastDeliveredAt: z.number().int().optional(),
  lastError: z.string().max(500).optional(),
  /** Operations whose committed changes are posted, from the launcher setting. */
  observing: z.array(z.string()),
});

export const webhookOperations = {
  statusGet: defineCapability({
    id: 'webhook.status.get',
    kind: 'query',
    description:
      'Read webhook delivery status: which operations are observed, how many change notifications were delivered, the journal cursor reached, and the last delivery error. Use it to check whether the downstream system receives notifications.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(webhookStatusSchema),
    permission: { action: 'read', resourceType: 'Webhook' },
    ui: { binding: 'webhook-status' },
  }),
  deliveryRecord: defineCapability({
    id: 'webhook.delivery.record',
    kind: 'command',
    description:
      'Record the outcome of one webhook delivery pass: the cursor reached and how many notifications were posted, or the error. Called by the plugin delivery loop as a delegated caller.',
    input: jsonSchema(
      z.strictObject({
        cursor: count.optional(),
        delivered: count,
        error: z.string().max(500).optional(),
      }),
    ),
    output: jsonSchema(webhookStatusSchema.omit({ observing: true })),
    permission: { action: 'write', resourceType: 'Webhook' },
    ui: {
      exception:
        'Written only by the delivery loop, which runs as a delegated caller; people read the result through webhook.status.get.',
    },
    audit: { fields: ['cursor', 'delivered'] },
  }),
} as const;

/** Browser-safe module: one status query and the delivery loop's record command. */
export const webhookModule = defineModule({
  id: 'webhook',
  capabilities: Object.values(webhookOperations),
});
