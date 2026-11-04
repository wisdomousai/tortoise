import { z } from 'zod';
import {
  ApplicationError,
  blobRefSchema,
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
  jsonValueSchema,
  type BlobRef,
} from '@tortoise/contracts';
import { auditPlugin } from '@tortoise/audit/plugin';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { createDeviceLinkPlugin } from '@tortoise/device-link/plugin';
import { deviceLinkPluginManifest } from '@tortoise/device-link/plugin-manifest';
import { defineApplication } from '@tortoise/kernel/application';
import { LOCAL_OWNER } from '@tortoise/kernel/instance';
import { defineManifest } from '@tortoise/kernel/manifest';
import type { HostPlugin } from '@tortoise/kernel/plugin';
import type { PluginManifest } from '@tortoise/kernel/plugin-manifest';
import { createHandlerFactory } from '@tortoise/runtime';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import {
  fleetInstanceModule,
  fleetInstanceOperations,
  relayRequestSchema,
  releaseSchema,
  type FleetRelease,
  type RelayResponse,
  type RelayRequest,
  type InstanceReport,
} from '../src/contracts';
import { createFleetAgentPlugin } from '../src/plugin';
import { fleetAgentPluginManifest } from '../src/plugin-manifest';

// The fleet: one channel, instances enrolled with device-link, each instance seeing only its own record.
interface FleetInstance {
  report?: InstanceReport;
  auditSeq: number;
  events: string[];
  relay: RelayRequest[];
  responses: Record<string, RelayResponse>;
}
interface FleetState {
  instances: Record<string, FleetInstance>;
  release?: FleetRelease;
}

const releaseSet = defineCapability({
  id: 'fixture.release.set',
  kind: 'command',
  input: jsonSchema(z.strictObject({ release: releaseSchema, files: z.array(blobRefSchema) })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Release' },
  ui: { exception: 'test fixture' },
  blobs: { maxBytes: 1_000_000, mediaTypes: ['application/octet-stream'] },
});
const relayEnqueue = defineCapability({
  id: 'fixture.relay.enqueue',
  kind: 'command',
  input: jsonSchema(z.strictObject({ instance: z.string(), request: relayRequestSchema })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Instance' },
  ui: { exception: 'test fixture' },
});
const fleetRead = defineCapability({
  id: 'fixture.fleet.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.record(z.string(), jsonValueSchema)),
  permission: { action: 'read', resourceType: 'Instance' },
  ui: { exception: 'test fixture' },
});

const instanceOf = (state: FleetState, principalId: string): FleetInstance => {
  if (!principalId.startsWith('device:'))
    throw new ApplicationError('FORBIDDEN', 'Only an enrolled instance calls the fleet protocol');
  const id = principalId.slice('device:'.length);
  if (!Object.hasOwn(state.instances, id))
    state.instances[id] = { auditSeq: 0, events: [], relay: [], responses: {} };
  return state.instances[id]!;
};
const protocol = new Set<string>(
  Object.values(fleetInstanceOperations).map((operation) => operation.id),
);

const fleetBind = createHandlerFactory<FleetState, unknown>();

export function fleetApplication() {
  return defineApplication<FleetState>({
    manifest: defineManifest({
      id: 'fleet',
      title: 'Fleet',
      modules: [
        fleetInstanceModule,
        defineModule({ id: 'fixture', capabilities: [releaseSet, relayEnqueue, fleetRead] }),
      ],
      plugins: [deviceLinkPluginManifest],
    }),
    createState: () => ({ instances: {} }),
    handlers: [
      fleetBind(fleetInstanceOperations.report, async (input, ctx) => {
        instanceOf(ctx.state, ctx.context.principalId).report = input;
        ctx.change(`instance:${ctx.context.principalId}`);
        return {};
      }),
      fleetBind(fleetInstanceOperations.desired, async (_input, ctx) =>
        ctx.state.release ? { release: ctx.state.release } : {},
      ),
      fleetBind(fleetInstanceOperations.auditCursor, async (_input, ctx) => ({
        afterSeq: instanceOf(ctx.state, ctx.context.principalId).auditSeq,
      })),
      fleetBind(fleetInstanceOperations.auditIngest, async (input, ctx) => {
        const instance = instanceOf(ctx.state, ctx.context.principalId);
        for (const line of input.events) {
          const { seq } = JSON.parse(line) as { seq: number };
          if (seq <= instance.auditSeq) continue;
          if (seq !== instance.auditSeq + 1)
            throw new ApplicationError('CONFLICT', `Expected audit event ${instance.auditSeq + 1}`);
          instance.events.push(line);
          instance.auditSeq = seq;
        }
        ctx.change(`instance:${ctx.context.principalId}`);
        return { afterSeq: instance.auditSeq };
      }),
      fleetBind(fleetInstanceOperations.relayClaim, async (_input, ctx) => {
        const request = instanceOf(ctx.state, ctx.context.principalId).relay.shift();
        ctx.change(`instance:${ctx.context.principalId}`);
        return request ? { request } : {};
      }),
      fleetBind(fleetInstanceOperations.relayRespond, async (input, ctx) => {
        instanceOf(ctx.state, ctx.context.principalId).responses[input.id] = input;
        ctx.change(`instance:${ctx.context.principalId}`);
        return {};
      }),
      fleetBind(releaseSet, async (input, ctx) => {
        ctx.state.release = input.release;
        ctx.change(`release:${input.release.id}`);
        for (const file of input.files) ctx.attach(`release:${input.release.id}`, file);
        return {};
      }),
      fleetBind(relayEnqueue, async (input, ctx) => {
        instanceOf(ctx.state, `device:${input.instance}`).relay.push(input.request);
        ctx.change(`instance:device:${input.instance}`);
        return {};
      }),
      fleetBind(fleetRead, async (_input, ctx) => JSON.parse(JSON.stringify(ctx.state))),
    ],
    authorization: {
      authorize: ({ capability, context }) => ({
        allowed:
          context.principalId === LOCAL_OWNER ||
          (context.principalId.startsWith('device:') && protocol.has(capability.id)),
        reason: 'RESOURCE_DENIED',
      }),
      // An instance reads the release blobs; nothing else of the fleet.
      canReadEvent: ({ context, event }) =>
        context.principalId === LOCAL_OWNER ||
        (context.principalId.startsWith('device:') && event.resource.startsWith('release:')),
    },
    plugins: [createDeviceLinkPlugin({ syncOperations: [...protocol] })],
  });
}

// The instance: notes that also queue an effect for an ERP no dispatcher here delivers.
const noteAdd = defineCapability({
  id: 'notes.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ text: z.string() })),
  output: jsonSchema(z.strictObject({ count: z.number() })),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const noteCount = defineCapability({
  id: 'notes.count',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ count: z.number() })),
  permission: { action: 'read', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const erp = defineHostComponent({
  id: 'erp-client',
  description: 'Fixture system of record.',
  requirements: {
    network: [
      {
        id: 'erp-api',
        purpose: 'Fixture destination.',
        direction: 'egress',
        scope: 'local',
        protocol: 'https',
        dataClasses: ['note'],
        availability: 'optional',
        offline: 'queue',
        targets: ['erp'],
      },
    ],
  },
});

type Notes = { notes: Record<string, number> };
const instanceBind = createHandlerFactory<Notes, unknown>();

/** The instance's network plugin: `fleetNetworkFixture` in process, the real one in a release. */
export interface InstanceNetwork {
  readonly manifest: PluginManifest;
  readonly plugin: HostPlugin;
}

/**
 * The instance application at `version`. Version 1 keeps `notes.count`; version 2 renames it to
 * `notes.total` through a migration, so an upgrade has state to migrate. Its contract version
 * follows, so each queued effect records the release that queued it.
 */
export function instanceApplication(network: InstanceNetwork, version: 1 | 2 = 1) {
  const field = version === 1 ? 'count' : 'total';
  return defineApplication<Notes>({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteCount] })],
      components: [erp],
      plugins: [
        deploymentPluginManifest,
        network.manifest,
        auditPluginManifest,
        fleetAgentPluginManifest,
      ],
    }),
    createState: () => ({ notes: { [field]: 0 } }),
    contractVersion: String(version),
    ...(version === 2
      ? {
          migrations: {
            version: 2,
            steps: [
              {
                from: 1,
                to: 2,
                up: (state: unknown) => ({
                  notes: { total: (state as { notes: { count: number } }).notes.count },
                }),
              },
            ],
          },
        }
      : {}),
    handlers: [
      instanceBind(noteAdd, async (input, ctx) => {
        const count = (ctx.state.notes[field] ?? 0) + 1;
        ctx.state.notes[field] = count;
        ctx.change(`note:${count}`);
        ctx.enqueue({
          target: 'erp',
          type: 'note.created',
          resource: `note:${count}`,
          payload: { text: input.text },
        });
        return { count };
      }),
      instanceBind(noteCount, async (_input, ctx) => ({ count: ctx.state.notes[field] ?? 0 })),
    ],
    authorization: {
      authorize: ({ context }) => ({
        allowed: context.principalId === LOCAL_OWNER,
        reason: 'RESOURCE_DENIED',
      }),
      canReadEvent: ({ context }) => context.principalId === LOCAL_OWNER,
    },
    plugins: [
      deploymentPlugin,
      network.plugin,
      auditPlugin,
      createFleetAgentPlugin({ intervalMs: 3_600_000, relayMs: 3_600_000 }),
    ],
  });
}
