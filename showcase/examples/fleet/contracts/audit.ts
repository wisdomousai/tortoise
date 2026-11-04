import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCollection,
  jsonValueSchema,
  recordKeySchema,
} from '@tortoise/contracts';

/**
 * One audit event an instance forwarded, keyed `<instance>:<seq>`, after the fleet checked its hash and
 * its link to the previous event. The event is kept as the instance logged it, so it can be checked
 * again; the fleet keeps the newest 1,000 per instance.
 */
export const auditEventSchema = z.strictObject({
  id: recordKeySchema,
  instance: recordKeySchema,
  seq: z.number().int().positive(),
  kind: z.string().max(128),
  at: z.number().int().nonnegative(),
  hash: z.string().max(64),
  event: jsonValueSchema,
});
export type AuditEventRecord = z.output<typeof auditEventSchema>;

export const auditEvents = defineCollection({
  type: 'audit-event',
  resourceType: 'AuditEvent',
  item: auditEventSchema,
  label: { one: 'Audit event', many: 'Audit events' },
});

/** The verified events an instance forwarded are kept up to this many per instance. */
export const AUDIT_EVENTS_PER_INSTANCE = 1000;

export const auditOperations = {
  auditEventList: collectionList(auditEvents, {
    id: 'audit-event',
    description:
      'List forwarded audit events, newest first, each checked against the instance’s hash chain. Filter by instance or kind, or search both.',
    filters: ['instance', 'kind'],
    search: true,
  }),
  auditEventGet: collectionGet(auditEvents, {
    id: 'audit-event',
    description: 'Read one forwarded audit event as the instance logged it, by `<instance>:<seq>`.',
  }),
} as const;
