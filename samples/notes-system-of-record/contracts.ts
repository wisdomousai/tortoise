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
} from '@agent-native/contracts';

/** The network destination that carries the publisher; the site policy binds its URL. */
export const PUBLISHER_DESTINATION = 'publisher-api';

/**
 * One note's publication, keyed by the note's id: the title it was sent with and where its
 * delivery stands. `sorRef` is the publisher's id once it accepted the note.
 */
export const publicationSchema = z.strictObject({
  id: recordKeySchema,
  title: z.string().max(200),
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
  titleField: 'title',
  fields: [
    { name: 'title' },
    { name: 'sync', label: 'Delivery' },
    { name: 'sorRef', label: 'Publisher id' },
    { name: 'publishedAt', label: 'Sent' },
  ],
});

/** A note someone posted on the publisher's site, as its change feed reports it. */
export const postedNoteSchema = z.strictObject({
  id: recordKeySchema,
  title: z.string().max(200),
  text: z.string().max(10_000),
});
export type PostedNote = z.output<typeof postedNoteSchema>;

/**
 * The publisher as a system of record: notes are forwarded to it, and its feed delivers notes
 * posted on its site, which become notes here.
 */
export const publisherTarget = defineTarget({
  target: 'publisher',
  resourceType: 'Publication',
  settles: ['publication'],
  feed: { item: postedNoteSchema, max: 50, changes: ['note'] },
  status: { pending: z.number().int(), accepted: z.number().int(), rejected: z.number().int() },
  descriptions: {
    settle: 'Integration principal only: record the publisher’s outcome for a published note.',
    sync: 'Integration principal only: add notes posted on the publisher’s site and advance the watermark. A stale from watermark conflicts.',
    status:
      'Summarize publications: waiting for the publisher, accepted and rejected, and the last import of posted notes.',
  },
});

/** Publishing notes, the publisher target's operations and reconciliation. Browser-safe. */
export const publishingOperations = {
  publicationList: collectionList(publications, {
    id: 'publication',
    description: 'List publications, with where each delivery stands.',
    filters: ['sync'],
  }),
  publicationGet: collectionGet(publications, {
    id: 'publication',
    description: 'Read the publication of one note, by the note id, or NOT_FOUND.',
  }),
  publicationPublish: defineCapability({
    id: 'publication.publish',
    kind: 'command',
    description:
      'Publish a note to the publisher. It is sent after this commit; the publication shows when the publisher accepts or rejects it. Editors only; a publication still waiting conflicts.',
    input: jsonSchema(z.strictObject({ id: recordKeySchema })),
    output: jsonSchema(publicationSchema),
    permission: { action: 'publish', resourceType: 'Publication' },
    dependencies: ['publication'],
    integration: { target: publisherTarget.target, delivery: 'outbox' },
    ui: { binding: 'publication.publish' },
    display: { label: 'Publish note', resource: 'publication', titleField: 'title' },
  }),
  publisherSettle: publisherTarget.settle,
  publisherSync: publisherTarget.sync!,
  publisherStatus: publisherTarget.status,
  ...reconciliationOperations,
} as const;

export const publishingModule = defineModule({
  id: 'note-publishing',
  capabilities: Object.values(publishingOperations),
  requirements: {
    network: [
      {
        id: PUBLISHER_DESTINATION,
        purpose:
          'Send published notes to the publisher, ask it about earlier deliveries and read notes posted on its site.',
        direction: 'egress',
        // The sample's publisher is a fake on this machine; a real one is `site` or `internet`
        // over `https`.
        scope: 'loopback',
        protocol: 'http',
        targets: [publisherTarget.target],
        dataClasses: ['note'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
});
