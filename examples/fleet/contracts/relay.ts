import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';
import { relayAnswerSchema, relayRequestSchema } from '@agent-native/fleet-agent/contracts';

/**
 * A remote-access request to one site's API and, once the site answered, its response. The
 * request's headers are dropped when the site takes it, so a site session passed in
 * `authorization` stays in the fleet's state only while the request waits.
 */
export const relaySchema = z.strictObject({
  id: recordKeySchema,
  site: recordKeySchema,
  method: relayRequestSchema.shape.method,
  path: relayRequestSchema.shape.path,
  status: z.enum(['waiting', 'taken', 'answered']),
  requestedBy: z.string().max(128),
  requestedAt: z.number().int().nonnegative(),
  answeredAt: z.number().int().nonnegative().optional(),
  /** The HTTP status the site's API answered. */
  response: relayAnswerSchema.shape.status.optional(),
  responseHeaders: relayAnswerSchema.shape.headers.optional(),
  /** Base64 response body. */
  responseBody: relayAnswerSchema.shape.body,
});
export type Relay = z.output<typeof relaySchema>;

export const relays = defineCollection({
  type: 'relay',
  resourceType: 'Relay',
  item: relaySchema,
  label: { one: 'Relay request', many: 'Relay requests' },
});

/** Relay requests are kept up to this many, oldest answered first out. */
export const RELAYS_KEPT = 200;

export const relayOperations = {
  relayList: collectionList(relays, {
    id: 'relay',
    description:
      'List remote-access requests, newest first, with the status the site answered. Filter by site or status.',
    filters: ['site', 'status'],
  }),
  relayGet: collectionGet(relays, {
    id: 'relay',
    description: 'Read one remote-access request and the response body the site returned.',
  }),
  relayRequest: defineCapability({
    id: 'relay.request',
    kind: 'command',
    description:
      'Ask a site to forward one request to its own API, under /api/v1/. The site adds no credential: put a session the site issued in headers.authorization, or the site answers 403. The site takes the request on its next relay poll. People only, operators only.',
    input: jsonSchema(
      z.strictObject({
        site: recordKeySchema,
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
    audit: { fields: ['site', 'method', 'path'] },
  }),
} as const;
