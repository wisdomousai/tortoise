import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCollection,
  jsonValueSchema,
  recordKeySchema,
} from '@tortoise/contracts';

/**
 * One audit event a site forwarded, keyed `<site>:<seq>`, after the fleet checked its hash and
 * its link to the previous event. The event is kept as the site logged it, so it can be checked
 * again; the fleet keeps the newest 1,000 per site.
 */
export const auditEventSchema = z.strictObject({
  id: recordKeySchema,
  site: recordKeySchema,
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

/** The verified events a site forwarded are kept up to this many per site. */
export const AUDIT_EVENTS_PER_SITE = 1000;

export const auditOperations = {
  auditEventList: collectionList(auditEvents, {
    id: 'audit-event',
    description:
      'List forwarded audit events, newest first, each checked against the site’s hash chain. Filter by site or kind, or search both.',
    filters: ['site', 'kind'],
    search: true,
  }),
  auditEventGet: collectionGet(auditEvents, {
    id: 'audit-event',
    description: 'Read one forwarded audit event as the site logged it, by `<site>:<seq>`.',
  }),
} as const;
