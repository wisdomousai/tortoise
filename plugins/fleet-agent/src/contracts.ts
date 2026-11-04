import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  jsonValueSchema,
} from '@tortoise/contracts';

/**
 * The fleet protocol: the operations a fleet application serves to the instances enrolled with it.
 * An instance calls them over the fleet's HTTP API as its own enrolled principal; the fleet returns data
 * only about that instance. Browser-safe data, shared by `plugins/fleet-agent` (the instance side) and
 * any fleet application, which composes `fleetInstanceModule` and implements the handlers.
 */

/** Where an instance exchanges an enrollment code for its credential: the fleet's device-link route. */
export const fleetEnrollPath = '/api/v1/link/enroll';

const count = z.number().int().min(0);
const id = z.string().min(1).max(128);
const headers = z.record(z.string().max(64), z.string().max(8192));

export const instanceReportSchema = z.strictObject({
  application: id,
  /** The instance that reported; changes on every restart. */
  instance: id,
  at: count,
  /** The outbox by target, as `drain` accounts for it. */
  outbox: z.strictObject({
    pending: count,
    held: count,
    acknowledged: count,
    targets: z
      .array(
        z.strictObject({
          target: id,
          pending: count,
          held: count,
          acknowledged: count,
        }),
      )
      .max(100),
  }),
  /** The local audit chain's head sequence, so the fleet sees how far its copy lags. */
  auditHead: count.optional(),
  /** The newest release the instance staged for activation, by fleet release ID. */
  staged: z.strictObject({ release: id, version: z.string().min(1).max(64) }).optional(),
  /** The running build's best-before date, `YYYY-MM-DD`, when the application has a shelf life. */
  bestBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type InstanceReport = z.infer<typeof instanceReportSchema>;

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
  /** A path on the instance's own API, under `/api/v1/`. */
  path: z
    .string()
    .regex(/^\/api\/v1\/[^\s#]*$/)
    .max(2048),
  headers,
  /** Base64 request body. */
  body: z.string().max(1_400_000).optional(),
});
export type RelayRequest = z.infer<typeof relayRequestSchema>;
export const relayResponseSchema = z.strictObject({
  id,
  status: z.number().int().min(100).max(599),
  headers,
  /** Base64 response body. */
  body: z.string().max(1_400_000).optional(),
});
export type RelayResponse = z.infer<typeof relayResponseSchema>;

const instance = { action: 'write', resourceType: 'Instance' } as const;
const instanceRead = { action: 'read', resourceType: 'Instance' } as const;
const calledByInstances = {
  exception: 'Called by enrolled instances over HTTP, never from a screen',
};

export const fleetInstanceOperations = {
  report: defineCapability({
    id: 'fleet.instance.report',
    kind: 'command',
    description:
      "Record the calling instance's health: its application, instance, outbox backlog by target, audit head and staged release.",
    input: jsonSchema(instanceReportSchema),
    output: jsonSchema(z.strictObject({})),
    permission: instance,
    ui: calledByInstances,
  }),
  desired: defineCapability({
    id: 'fleet.instance.desired',
    kind: 'query',
    description: 'The release the calling instance should run, from the channel it is assigned to.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ release: releaseSchema.optional() })),
    permission: instanceRead,
    ui: calledByInstances,
  }),
  auditCursor: defineCapability({
    id: 'fleet.audit.cursor',
    kind: 'query',
    description:
      'The last audit sequence the fleet holds for the calling instance; the instance sends what follows it.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ afterSeq: count })),
    permission: instanceRead,
    ui: calledByInstances,
  }),
  auditIngest: defineCapability({
    id: 'fleet.audit.ingest',
    kind: 'command',
    description:
      "Append the calling instance's audit events, each as the JSON line of its local log, in sequence order directly after the fleet's last one. Returns the new last sequence.",
    input: jsonSchema(
      z.strictObject({ events: z.array(z.string().min(2).max(65_536)).min(1).max(100) }),
    ),
    output: jsonSchema(z.strictObject({ afterSeq: count })),
    permission: instance,
    ui: calledByInstances,
  }),
  relayClaim: defineCapability({
    id: 'fleet.relay.claim',
    kind: 'command',
    description:
      'Take the oldest remote-access request waiting for the calling instance, if any, so the instance forwards it to its own API.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ request: relayRequestSchema.optional() })),
    permission: instance,
    ui: calledByInstances,
  }),
  relayRespond: defineCapability({
    id: 'fleet.relay.respond',
    kind: 'command',
    description: "Record the instance API's response to a remote-access request the instance took.",
    input: jsonSchema(relayResponseSchema),
    output: jsonSchema(z.strictObject({})),
    permission: instance,
    ui: calledByInstances,
  }),
} as const;

/** The operations above as a module, for a fleet application's manifest. */
export const fleetInstanceModule = defineModule({
  id: 'fleet-instance',
  capabilities: Object.values(fleetInstanceOperations),
});
/** Every protocol operation, as a fleet's device-link sync grant names them. */
export const fleetInstanceOperationIds = Object.values(fleetInstanceOperations).map((op) => op.id);

/** The fleet destination and the folder bundles are staged in; a deployment policy binds both. */
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
        authenticated: true,
        dataClasses: ['instance-health', 'audit-event', 'release-bundle', 'remote-access'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
    folders: [
      {
        id: 'fleet-releases',
        purpose: 'Verified releases from the fleet, staged for `app install` to activate.',
        access: 'write',
        dataClasses: ['release-bundle'],
        availability: 'optional',
      },
    ],
  },
});
