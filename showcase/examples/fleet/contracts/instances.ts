import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@tortoise/contracts';
import { instanceReportSchema } from '@tortoise/fleet-agent/contracts';

const count = z.number().int().nonnegative();
export const channelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * One enrolled instance, by its device-link device ID, as its reports and audit forwarding leave it.
 * Created by the instance's first report.
 */
export const instanceSchema = z.strictObject({
  id: recordKeySchema,
  label: z.string().max(100).optional(),
  /** The release channel the instance follows; none until an operator assigns one. */
  channel: channelIdSchema.optional(),
  application: z.string().max(128),
  instance: z.string().max(128),
  lastSeenAt: z.number().int().nonnegative(),
  pending: count,
  held: count,
  acknowledged: count,
  /** Outbox counts by target from the last report. */
  targets: instanceReportSchema.shape.outbox.shape.targets,
  /** The instance's audit head as it reported it, and the last event the fleet holds and verified. */
  auditHead: count,
  auditSeq: count,
  auditHash: z.string().max(64),
  /** Why audit collection stopped: a gap or a broken hash chain at that sequence. */
  auditBroken: z.string().max(200).optional(),
  /** The release the instance staged, by fleet release ID. */
  staged: z.string().max(128).optional(),
  /** The best-before date of the build the instance runs, as it reported it. */
  bestBefore: instanceReportSchema.shape.bestBefore,
});
export type Instance = z.output<typeof instanceSchema>;

export const instances = defineCollection({
  type: 'instance',
  resourceType: 'Instance',
  item: instanceSchema,
  label: { one: 'Instance', many: 'Instances' },
});

/** An instance that needs a look, and why; computed when read. */
export const healthSchema = z.strictObject({
  instances: count,
  issues: z.array(
    z.strictObject({
      instance: recordKeySchema,
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

export const instanceOperations = {
  instanceList: collectionList(instances, {
    id: 'instance',
    description:
      'List enrolled instances with their last report: outbox counts, audit position and staged release. Filter by channel or search the ID, label and application.',
    filters: ['channel'],
    search: true,
  }),
  instanceGet: collectionGet(instances, {
    id: 'instance',
    description: 'Read one instance by its device ID, with outbox counts by target.',
  }),
  instanceUpdate: defineCapability({
    id: 'instance.update',
    kind: 'command',
    description:
      'Give an instance a label and assign the release channel it follows. Operators only; an unknown channel is refused.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        label: instanceSchema.shape.label,
        channel: channelIdSchema.optional(),
      }),
    ),
    output: jsonSchema(instanceSchema),
    permission: { action: 'write', resourceType: 'Instance' },
    dependencies: ['instance', 'channel'],
    ui: { binding: 'instance.update' },
  }),
  instanceRemove: defineCapability({
    id: 'instance.remove',
    kind: 'command',
    description:
      'Remove a decommissioned instance: its record and its remote-access requests. The audit events it forwarded stay. Revoke its device link first, or its next report adds it again. People only, operators only.',
    input: jsonSchema(z.strictObject({ id: recordKeySchema })),
    output: jsonSchema(z.strictObject({ removed: z.boolean() })),
    permission: { action: 'write', resourceType: 'Instance' },
    dependencies: ['instance', 'relay'],
    ui: { binding: 'instance.remove' },
    audit: { fields: ['id'] },
  }),
  fleetHealth: defineCapability({
    id: 'fleet.health',
    kind: 'query',
    description:
      'Instances that need a look: not reported for 15 minutes, effects held for reconciliation, a broken audit chain, audit forwarding far behind, a staged release other than its channel’s, or a build past its best-before date.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(healthSchema),
    permission: { action: 'read', resourceType: 'Instance' },
    dependencies: ['instance', 'channel'],
    ui: { binding: 'fleet.health' },
  }),
} as const;
