import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema, jsonValueSchema } from '@tortoise/contracts';

const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.number().int().min(0);
const operation = z.string().min(1).max(200);

/** One reply the dispatcher issued: what choosing `button` runs, stored under the nonce's digest. */
export const issuedReplySchema = z.strictObject({
  digest,
  button: id,
  handler: id,
  operation,
  input: z.record(z.string(), jsonValueSchema),
});

export const notificationOperations = {
  issue: defineCapability({
    id: 'notification.issue',
    kind: 'command',
    description:
      'Record the reply nonces of a notification about to be shown, by digest, bound to the notified principal, replacing those of an earlier attempt for the same effect. Called only by the notification dispatcher.',
    input: jsonSchema(
      z.strictObject({
        effectId: id,
        principal: z.string().min(1).max(200),
        action: id,
        replies: z.array(issuedReplySchema).max(8),
      }),
    ),
    output: jsonSchema(z.strictObject({ expiresAt: timestamp })),
    permission: { action: 'issue', resourceType: 'Notification' },
    ui: {
      exception:
        'Called by the notification dispatcher before it shows a notification; people never issue nonces.',
    },
    audit: { fields: ['effectId', 'action'] },
  }),
  replyGet: defineCapability({
    id: 'notification.reply.get',
    kind: 'query',
    description:
      'The operation a reply would continue with, for a live reply issued to the caller; null otherwise. Called only by the reply consumer, to narrow the redeeming grant.',
    input: jsonSchema(z.strictObject({ digest })),
    output: jsonSchema(z.strictObject({ operation: operation.nullable() })),
    permission: { action: 'read', resourceType: 'Notification' },
    ui: {
      exception:
        'Called by the reply consumer for a reply a notification action sent; people reply from the notification.',
    },
  }),
  redeem: defineCapability({
    id: 'notification.redeem',
    kind: 'command',
    description:
      'Use a reply nonce once, as the principal it was issued to, and continue with the command it stands for in the same transaction. Every other reply of that notification stops working.',
    input: jsonSchema(z.strictObject({ nonce: id, button: id, handler: id })),
    output: jsonSchema(z.strictObject({ operation })),
    permission: { action: 'redeem', resourceType: 'Notification' },
    // It continues with whichever command the reply stands for.
    invokes: 'any',
    ui: {
      exception:
        'Called by the reply consumer when a person chooses a notification action; the notification is the binding.',
    },
    audit: { fields: ['button', 'handler'] },
  }),
} as const;

/** Browser-safe module of the notifications plugin: issuing and redeeming reply nonces. */
export const notificationsModule = defineModule({
  id: 'notifications',
  capabilities: Object.values(notificationOperations),
});
