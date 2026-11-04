import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  defineModule,
  defineTarget,
  deliveryShape,
  jsonSchema,
  reconciliationOperations,
  recordKeySchema,
} from '@tortoise/contracts';

/** The network destination that carries the LIMS; the site policy binds its URL. */
export const LIMS_DESTINATION = 'lims-api';

/**
 * One test request's publication, keyed by the request's id: the sample it was sent with and
 * where its delivery stands. `sorRef` is the LIMS id once the LIMS registered the request.
 */
export const publicationSchema = z.strictObject({
  id: recordKeySchema,
  sample: z.string().max(64),
  effectId: z.string(),
  ...deliveryShape,
  publishedAt: z.number().int().nonnegative(),
});
export type Publication = z.output<typeof publicationSchema>;

export const publications = defineCollection({
  type: 'publication',
  resourceType: 'Publication',
  item: publicationSchema,
  label: { one: 'Publication', many: 'Publications' },
  titleField: 'sample',
  fields: [
    { name: 'sample' },
    { name: 'sync', label: 'Delivery' },
    { name: 'sorRef', label: 'LIMS id' },
  ],
});

/** A test request registered at another site's LIMS front desk, as the LIMS feed reports it. */
export const registeredRequestSchema = z.strictObject({
  id: recordKeySchema,
  sample: z.string().min(1).max(64),
  transformer: z.string().min(1).max(64),
  description: z.string().max(10_000),
  method: z.string().max(200),
});
export type RegisteredRequest = z.output<typeof registeredRequestSchema>;

/**
 * The enterprise LIMS as a system of record: test requests are registered there, and its feed
 * delivers requests registered at other sites, which become test requests here.
 */
export const limsTarget = defineTarget({
  target: 'lims',
  resourceType: 'Publication',
  changes: ['publication'],
  feed: { item: registeredRequestSchema, max: 50, changes: ['test-request'] },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    complete: 'Integration principal only: record the LIMS outcome for a published test request.',
    sync: 'Integration principal only: add test requests registered at other sites and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize publications: waiting for the LIMS, accepted and rejected, and the last import of requests registered elsewhere.',
  },
});

/** Publishing test requests, the LIMS target's operations and reconciliation. Browser-safe. */
export const publishingOperations = {
  publicationList: collectionList(publications, {
    id: 'publication',
    description: 'List publications, with where each delivery stands.',
    filters: ['sync'],
  }),
  publicationGet: collectionGet(publications, {
    id: 'publication',
    description: 'Read the publication of one test request, by the request id, or NOT_FOUND.',
  }),
  publicationPublish: defineCapability({
    id: 'publication.publish',
    kind: 'command',
    description:
      'Register a test request in the LIMS. It is sent after this commit; the publication shows when the LIMS accepts or rejects it. Technicians only; a publication still waiting conflicts.',
    input: jsonSchema(z.strictObject({ id: recordKeySchema })),
    output: jsonSchema(publicationSchema),
    permission: { action: 'publish', resourceType: 'Publication' },
    dependencies: ['publication'],
    integration: { target: limsTarget.target, delivery: 'outbox' },
    ui: { binding: 'publication.publish' },
    display: { label: 'Register in LIMS', resource: 'publication', titleField: 'sample' },
  }),
  limsComplete: limsTarget.complete,
  limsSync: limsTarget.sync!,
  limsStatus: limsTarget.status,
  ...reconciliationOperations,
} as const;

export const publishingModule = defineModule({
  id: 'request-publishing',
  capabilities: Object.values(publishingOperations),
  requirements: {
    network: [
      {
        id: LIMS_DESTINATION,
        purpose:
          'Register test requests in the LIMS, ask it about earlier deliveries and read requests registered at other sites.',
        direction: 'egress',
        // The pattern's LIMS is a fake on this machine; a real one is `site` or `internet` over
        // `https`.
        scope: 'loopback',
        protocol: 'http',
        targets: [limsTarget.target],
        dataClasses: ['test-request'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
});
