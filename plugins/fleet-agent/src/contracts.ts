import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  jsonValueSchema,
} from '@agent-native/contracts';

/**
 * The fleet protocol: the operations a fleet application serves to the sites enrolled with it.
 * A site calls them over the fleet's HTTP API as its own enrolled principal; the fleet answers
 * only about that site. Browser-safe data, shared by `plugins/fleet-agent` (the site side) and
 * any fleet application, which composes `fleetSiteModule` and implements the handlers.
 */

/** Where a site exchanges an enrollment code for its credential: the fleet's device-link route. */
export const fleetEnrollPath = '/api/v1/link/enroll';

const count = z.number().int().min(0);
const id = z.string().min(1).max(128);
const headers = z.record(z.string().max(64), z.string().max(8192));

export const siteReportSchema = z.strictObject({
  application: id,
  /** The instance that reported; changes on every restart. */
  instance: id,
  at: count,
  /** The outbox by target, as `drain` accounts for it. */
  outbox: z.strictObject({
    pending: count,
    held: count,
    upstream: count,
    targets: z
      .array(
        z.strictObject({
          target: id,
          pending: count,
          held: count,
          upstream: count,
        }),
      )
      .max(100),
  }),
  /** The local audit chain's head sequence, so the fleet sees how far its copy lags. */
  auditHead: count.optional(),
  /** The newest release the site staged for activation, by fleet release ID. */
  staged: z.strictObject({ release: id, version: z.string().min(1).max(64) }).optional(),
});
export type SiteReport = z.infer<typeof siteReportSchema>;

export const releaseSchema = z.strictObject({
  id,
  version: z.string().min(1).max(64),
  /** `bundle.json` as published; each file is the blob `sha256:<file sha256>`. */
  manifest: z.record(z.string(), jsonValueSchema),
  /** `bundle.sig`. */
  signature: z.strictObject({ keyId: z.string().max(64), signature: z.string().max(256) }),
});
export type FleetRelease = z.infer<typeof releaseSchema>;

export const relayRequestSchema = z.strictObject({
  id,
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** A path on the site's own API, under `/api/v1/`. */
  path: z
    .string()
    .regex(/^\/api\/v1\/[^\s#]*$/)
    .max(2048),
  headers,
  /** Base64 request body. */
  body: z.string().max(1_400_000).optional(),
});
export type RelayRequest = z.infer<typeof relayRequestSchema>;
export const relayAnswerSchema = z.strictObject({
  id,
  status: z.number().int().min(100).max(599),
  headers,
  /** Base64 response body. */
  body: z.string().max(1_400_000).optional(),
});
export type RelayAnswer = z.infer<typeof relayAnswerSchema>;

const site = { action: 'write', resourceType: 'Site' } as const;
const siteRead = { action: 'read', resourceType: 'Site' } as const;
const calledBySites = { exception: 'Called by enrolled sites over HTTP, never from a screen' };

export const fleetSiteOperations = {
  report: defineCapability({
    id: 'fleet.site.report',
    kind: 'command',
    description:
      "Record the calling site's health: its application, instance, outbox backlog by target, audit head and staged release.",
    input: jsonSchema(siteReportSchema),
    output: jsonSchema(z.strictObject({})),
    permission: site,
    ui: calledBySites,
  }),
  desired: defineCapability({
    id: 'fleet.site.desired',
    kind: 'query',
    description: 'The release the calling site should run, from the channel it is assigned to.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ release: releaseSchema.optional() })),
    permission: siteRead,
    ui: calledBySites,
  }),
  auditCursor: defineCapability({
    id: 'fleet.audit.cursor',
    kind: 'query',
    description:
      'The last audit sequence the fleet holds for the calling site; the site sends what follows it.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ afterSeq: count })),
    permission: siteRead,
    ui: calledBySites,
  }),
  auditIngest: defineCapability({
    id: 'fleet.audit.ingest',
    kind: 'command',
    description:
      "Append the calling site's audit events, each as the JSON line of its local log, in sequence order directly after the fleet's last one. Returns the new last sequence.",
    input: jsonSchema(
      z.strictObject({ events: z.array(z.string().min(2).max(65_536)).min(1).max(100) }),
    ),
    output: jsonSchema(z.strictObject({ afterSeq: count })),
    permission: site,
    ui: calledBySites,
  }),
  relayTake: defineCapability({
    id: 'fleet.relay.take',
    kind: 'command',
    description:
      'Take the oldest remote-access request waiting for the calling site, if any, so the site forwards it to its own API.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ request: relayRequestSchema.optional() })),
    permission: site,
    ui: calledBySites,
  }),
  relayAnswer: defineCapability({
    id: 'fleet.relay.answer',
    kind: 'command',
    description: "Record the site API's response to a remote-access request the site took.",
    input: jsonSchema(relayAnswerSchema),
    output: jsonSchema(z.strictObject({})),
    permission: site,
    ui: calledBySites,
  }),
} as const;

/** The operations above as a module, for a fleet application's manifest. */
export const fleetSiteModule = defineModule({
  id: 'fleet-site',
  capabilities: Object.values(fleetSiteOperations),
});
/** Every protocol operation, as a fleet's device-link sync grant names them. */
export const fleetSiteOperationIds = Object.values(fleetSiteOperations).map((op) => op.id);

/** The fleet destination and the folder bundles are staged in; a site policy binds both. */
export const fleetLinkComponent = defineHostComponent({
  id: 'fleet-link',
  description:
    'Reports to the fleet, forwards audit events, stages releases and relays remote access.',
  requirements: {
    network: [
      {
        id: 'fleet',
        purpose:
          'Report health, forward audit events, fetch assigned releases and take remote-access requests, outbound only.',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        dataClasses: ['site-health', 'audit-event', 'release-bundle', 'remote-access'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
    folders: [
      {
        id: 'fleet-releases',
        purpose: 'Verified releases from the fleet, staged for `site install` to activate.',
        access: 'write',
        dataClasses: ['release-bundle'],
        availability: 'optional',
      },
    ],
  },
});
