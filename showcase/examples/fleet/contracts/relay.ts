import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@tortoise/contracts';
import { relayResponseSchema, relayRequestSchema } from '@tortoise/fleet-agent/contracts';

/**
 * A remote-access request to one instance's API and, once the instance responded, its response. The
 * request's headers are dropped when the instance takes it, so an instance session passed in
 * `authorization` stays in the request's state only while it waits. The command receipt of
 * `relay.request` keeps the input as well, for as long as receipts are kept.
 */
export const relaySchema = z.strictObject({
  id: recordKeySchema,
  instance: recordKeySchema,
  method: relayRequestSchema.shape.method,
  path: relayRequestSchema.shape.path,
  status: z.enum(['queued', 'claimed', 'responded']),
  requestedBy: z.string().max(128),
  requestedAt: z.number().int().nonnegative(),
  respondedAt: z.number().int().nonnegative().optional(),
  /** The HTTP status the instance's API returned. */
  response: relayResponseSchema.shape.status.optional(),
  responseHeaders: relayResponseSchema.shape.headers.optional(),
  /** Base64 response body. */
  responseBody: relayResponseSchema.shape.body,
});
export type Relay = z.output<typeof relaySchema>;

export const relays = defineCollection({
  type: 'relay',
  resourceType: 'Relay',
  item: relaySchema,
  label: { one: 'Relay request', many: 'Relay requests' },
});

/** Relay requests are kept up to this many, oldest responded first out. */
export const RELAYS_KEPT = 200;

export const relayOperations = {
  relayList: collectionList(relays, {
    id: 'relay',
    description:
      'List remote-access requests, newest first, with the status the instance returned. Filter by instance or status.',
    filters: ['instance', 'status'],
  }),
  relayGet: collectionGet(relays, {
    id: 'relay',
    description: 'Read one remote-access request and the response body the instance returned.',
  }),
  relayRequest: defineCapability({
    id: 'relay.request',
    kind: 'command',
    description:
      'Ask an instance to forward one request to its own API, under /api/v1/. The instance adds no credential: put a session the instance issued in headers.authorization, or the instance returns 403. The instance takes the request on its next relay poll. People only, operators only.',
    input: jsonSchema(
      z.strictObject({
        instance: recordKeySchema,
        method: relayRequestSchema.shape.method,
        path: relayRequestSchema.shape.path,
        headers: relayRequestSchema.shape.headers.optional(),
        /** JSON request body, sent as UTF-8. */
        body: z.string().max(1_000_000).optional(),
      }),
    ),
    output: jsonSchema(z.strictObject({ id: recordKeySchema })),
    permission: { action: 'write', resourceType: 'Relay' },
    dependencies: ['relay'],
    ui: { binding: 'relay.request' },
    audit: { fields: ['instance', 'method', 'path'] },
  }),
} as const;
