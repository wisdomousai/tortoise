import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@tortoise/contracts';
import { siteReportSchema } from '@tortoise/fleet-agent/contracts';

const count = z.number().int().nonnegative();
export const channelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * One enrolled site, by its device-link device ID, as its reports and audit forwarding leave it.
 * Created by the site's first report.
 */
export const siteSchema = z.strictObject({
  id: recordKeySchema,
  label: z.string().max(100).optional(),
  /** The release channel the site follows; none until an operator assigns one. */
  channel: channelIdSchema.optional(),
  application: z.string().max(128),
  instance: z.string().max(128),
  lastSeenAt: z.number().int().nonnegative(),
  pending: count,
  held: count,
  acknowledged: count,
  /** Outbox counts by target from the last report. */
  targets: siteReportSchema.shape.outbox.shape.targets,
  /** The site's audit head as it reported it, and the last event the fleet holds and verified. */
  auditHead: count,
  auditSeq: count,
  auditHash: z.string().max(64),
  /** Why audit collection stopped: a gap or a broken hash chain at that sequence. */
  auditBroken: z.string().max(200).optional(),
  /** The release the site staged, by fleet release ID. */
  staged: z.string().max(128).optional(),
  /** The best-before date of the build the site runs, as it reported it. */
  bestBefore: siteReportSchema.shape.bestBefore,
});
export type Site = z.output<typeof siteSchema>;

export const sites = defineCollection({
  type: 'site',
  resourceType: 'Site',
  item: siteSchema,
  label: { one: 'Site', many: 'Sites' },
});

/** A site that needs a look, and why; computed when read. */
export const healthSchema = z.strictObject({
  sites: count,
  issues: z.array(
    z.strictObject({
      site: recordKeySchema,
      kind: z.enum([
        'stale',
        'held',
        'audit-broken',
        'audit-behind',
        'release-drift',
        'past-best-before',
      ]),
      detail: z.string().max(200),
    }),
  ),
});

export const siteOperations = {
  siteList: collectionList(sites, {
    id: 'site',
    description:
      'List enrolled sites with their last report: outbox counts, audit position and staged release. Filter by channel or search the ID, label and application.',
    filters: ['channel'],
    search: true,
  }),
  siteGet: collectionGet(sites, {
    id: 'site',
    description: 'Read one site by its device ID, with outbox counts by target.',
  }),
  siteUpdate: defineCapability({
    id: 'site.update',
    kind: 'command',
    description:
      'Give a site a label and assign the release channel it follows. Operators only; an unknown channel is refused.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        label: siteSchema.shape.label,
        channel: channelIdSchema.optional(),
      }),
    ),
    output: jsonSchema(siteSchema),
    permission: { action: 'write', resourceType: 'Site' },
    dependencies: ['site', 'channel'],
    ui: { binding: 'site.update' },
  }),
  siteRemove: defineCapability({
    id: 'site.remove',
    kind: 'command',
    description:
      'Remove a decommissioned site: its record and its remote-access requests. The audit events it forwarded stay. Revoke its device link first, or its next report adds it again. People only, operators only.',
    input: jsonSchema(z.strictObject({ id: recordKeySchema })),
    output: jsonSchema(z.strictObject({ removed: z.boolean() })),
    permission: { action: 'write', resourceType: 'Site' },
    dependencies: ['site', 'relay'],
    ui: { binding: 'site.remove' },
    audit: { fields: ['id'] },
  }),
  fleetHealth: defineCapability({
    id: 'fleet.health',
    kind: 'query',
    description:
      'Sites that need a look: not reported for 15 minutes, effects held for reconciliation, a broken audit chain, audit forwarding far behind, a staged release other than its channel’s, or a build past its best-before date.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(healthSchema),
    permission: { action: 'read', resourceType: 'Site' },
    dependencies: ['site', 'channel'],
    ui: { binding: 'fleet.health' },
  }),
} as const;
