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
} from '@agent-native/contracts';
import { auditPlugin } from '@agent-native/audit/plugin';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { createDeviceLinkPlugin } from '@agent-native/device-link/plugin';
import { deviceLinkPluginManifest } from '@agent-native/device-link/plugin-manifest';
import { defineApplication } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/authority';
import { defineManifest } from '@agent-native/kernel/manifest';
import { createHandlerFactory } from '@agent-native/runtime';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import {
  fleetSiteModule,
  fleetSiteOperations,
  relayRequestSchema,
  releaseSchema,
  type FleetRelease,
  type RelayAnswer,
  type RelayRequest,
  type SiteReport,
} from '../src/contracts';
import { createFleetAgentPlugin } from '../src/plugin';
import { fleetAgentPluginManifest } from '../src/plugin-manifest';
import type { fleetNetworkFixture } from '../src/testing';

// The fleet: one channel, sites enrolled with device-link, each site seeing only its own record.
interface FleetSite {
  report?: SiteReport;
  auditSeq: number;
  events: string[];
  relay: RelayRequest[];
  answers: Record<string, RelayAnswer>;
}
interface FleetState {
  sites: Record<string, FleetSite>;
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
  input: jsonSchema(z.strictObject({ site: z.string(), request: relayRequestSchema })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Site' },
  ui: { exception: 'test fixture' },
});
const fleetRead = defineCapability({
  id: 'fixture.fleet.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.record(z.string(), jsonValueSchema)),
  permission: { action: 'read', resourceType: 'Site' },
  ui: { exception: 'test fixture' },
});

const siteOf = (state: FleetState, principalId: string): FleetSite => {
  if (!principalId.startsWith('device:'))
    throw new ApplicationError('FORBIDDEN', 'Only an enrolled site calls the fleet protocol');
  const id = principalId.slice('device:'.length);
  if (!Object.hasOwn(state.sites, id))
    state.sites[id] = { auditSeq: 0, events: [], relay: [], answers: {} };
  return state.sites[id]!;
};
const protocol = new Set<string>(
  Object.values(fleetSiteOperations).map((operation) => operation.id),
);

const fleetBind = createHandlerFactory<FleetState, unknown>();

export function fleetApplication() {
  return defineApplication<FleetState>({
    manifest: defineManifest({
      id: 'fleet',
      title: 'Fleet',
      modules: [
        fleetSiteModule,
        defineModule({ id: 'fixture', capabilities: [releaseSet, relayEnqueue, fleetRead] }),
      ],
      plugins: [deviceLinkPluginManifest],
    }),
    createState: () => ({ sites: {} }),
    handlers: [
      fleetBind(fleetSiteOperations.report, async (input, ctx) => {
        siteOf(ctx.state, ctx.context.principalId).report = input;
        ctx.change(`site:${ctx.context.principalId}`);
        return {};
      }),
      fleetBind(fleetSiteOperations.desired, async (_input, ctx) =>
        ctx.state.release ? { release: ctx.state.release } : {},
      ),
      fleetBind(fleetSiteOperations.auditCursor, async (_input, ctx) => ({
        afterSeq: siteOf(ctx.state, ctx.context.principalId).auditSeq,
      })),
      fleetBind(fleetSiteOperations.auditIngest, async (input, ctx) => {
        const site = siteOf(ctx.state, ctx.context.principalId);
        for (const line of input.events) {
          const { seq } = JSON.parse(line) as { seq: number };
          if (seq <= site.auditSeq) continue;
          if (seq !== site.auditSeq + 1)
            throw new ApplicationError('CONFLICT', `Expected audit event ${site.auditSeq + 1}`);
          site.events.push(line);
          site.auditSeq = seq;
        }
        ctx.change(`site:${ctx.context.principalId}`);
        return { afterSeq: site.auditSeq };
      }),
      fleetBind(fleetSiteOperations.relayTake, async (_input, ctx) => {
        const request = siteOf(ctx.state, ctx.context.principalId).relay.shift();
        ctx.change(`site:${ctx.context.principalId}`);
        return request ? { request } : {};
      }),
      fleetBind(fleetSiteOperations.relayAnswer, async (input, ctx) => {
        siteOf(ctx.state, ctx.context.principalId).answers[input.id] = input;
        ctx.change(`site:${ctx.context.principalId}`);
        return {};
      }),
      fleetBind(releaseSet, async (input, ctx) => {
        ctx.state.release = input.release;
        ctx.change(`release:${input.release.id}`);
        for (const file of input.files) ctx.attach(`release:${input.release.id}`, file);
        return {};
      }),
      fleetBind(relayEnqueue, async (input, ctx) => {
        siteOf(ctx.state, `device:${input.site}`).relay.push(input.request);
        ctx.change(`site:device:${input.site}`);
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
      // A site reads the release blobs; nothing else of the fleet.
      canReadEvent: ({ context, event }) =>
        context.principalId === LOCAL_OWNER ||
        (context.principalId.startsWith('device:') && event.resource.startsWith('release:')),
    },
    plugins: [createDeviceLinkPlugin({ syncOperations: [...protocol] })],
  });
}

// The site: notes that also queue an effect for an ERP no dispatcher here delivers.
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
        scope: 'site',
        protocol: 'https',
        dataClasses: ['note'],
        availability: 'optional',
        offline: 'queue',
        targets: ['erp'],
      },
    ],
  },
});

const siteBind = createHandlerFactory<{ notes: { count: number } }, unknown>();

export function siteApplication(network: ReturnType<typeof fleetNetworkFixture>) {
  return defineApplication<{ notes: { count: number } }>({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteCount] })],
      components: [erp],
      plugins: [
        sitePluginManifest,
        network.manifest,
        auditPluginManifest,
        fleetAgentPluginManifest,
      ],
    }),
    createState: () => ({ notes: { count: 0 } }),
    handlers: [
      siteBind(noteAdd, async (input, ctx) => {
        ctx.state.notes.count++;
        ctx.change(`note:${ctx.state.notes.count}`);
        ctx.enqueue({
          target: 'erp',
          type: 'note.created',
          resource: `note:${ctx.state.notes.count}`,
          payload: { text: input.text },
        });
        return { count: ctx.state.notes.count };
      }),
      siteBind(noteCount, async (_input, ctx) => ({ count: ctx.state.notes.count })),
    ],
    authorization: {
      authorize: ({ context }) => ({
        allowed: context.principalId === LOCAL_OWNER,
        reason: 'RESOURCE_DENIED',
      }),
      canReadEvent: ({ context }) => context.principalId === LOCAL_OWNER,
    },
    plugins: [
      sitePlugin,
      network.plugin,
      auditPlugin,
      createFleetAgentPlugin({ intervalMs: 3_600_000, relayMs: 3_600_000 }),
    ],
  });
}
