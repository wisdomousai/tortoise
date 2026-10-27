import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { auditPlugin } from '@agent-native/audit/plugin';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { createFleetAgentPlugin, type FleetAgentService } from '@agent-native/fleet-agent/plugin';
import { fleetAgentPluginManifest } from '@agent-native/fleet-agent/plugin-manifest';
import { fleetNetworkFixture } from '@agent-native/fleet-agent/testing';
import { defineApplication } from '@agent-native/host/application';
import { startHost } from '@agent-native/host/host';
import { defineManifest } from '@agent-native/host/manifest';
import { stampBuild } from '@agent-native/kernel/build';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { createHandlerFactory } from '@agent-native/runtime';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';

/** A plant's instance: notes that queue an effect for an ERP nothing here delivers to. */
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
type PlantState = { count: number };
const bind = createHandlerFactory<PlantState, unknown>();

export const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };

/** The plant as a built binary would run it: a 30-day shelf life from `builtAt`. */
function plantApplication(network: ReturnType<typeof fleetNetworkFixture>, builtAt: string) {
  const definition = defineApplication<PlantState>({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      shelfLifeDays: 30,
      modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteCount] })],
      components: [erp],
      plugins: [
        sitePluginManifest,
        network.manifest,
        auditPluginManifest,
        fleetAgentPluginManifest,
      ],
    }),
    createState: () => ({ count: 0 }),
    handlers: [
      bind(noteAdd, async (input, ctx) => {
        ctx.state.count++;
        ctx.change(`note:${ctx.state.count}`);
        ctx.enqueue({
          target: 'erp',
          type: 'note.created',
          resource: `note:${ctx.state.count}`,
          payload: { text: input.text },
        });
        return { count: ctx.state.count };
      }),
      bind(noteCount, async (_input, ctx) => ({ count: ctx.state.count })),
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
  return stampBuild(definition, builtAt);
}

/**
 * Start a plant on loopback whose `fleet` destination goes through `reach`, which the test maps
 * onto the fleet. Returns the host, its fleet agent, its staging folder and `close`, which
 * removes everything.
 */
export async function startPlant(
  reach: (url: URL, init?: RequestInit) => Promise<Response>,
  settings: { code: string; trust?: string; relay?: boolean; builtAt?: string },
) {
  const directory = await mkdtemp(join(tmpdir(), 'plant-'));
  const releases = join(directory, 'releases');
  await mkdir(releases);
  await writeFile(
    join(directory, 'site-policy.json'),
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      folders: { 'fleet-releases': { path: releases } },
    }),
  );
  const network = fleetNetworkFixture(reach);
  const builtAt = settings.builtAt ?? new Date().toISOString();
  const host = await startHost(plantApplication(network, builtAt), {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: {
      'site-policy': join(directory, 'site-policy.json'),
      'fleet-enrollment-code': settings.code,
      ...(settings.trust ? { 'fleet-trust': settings.trust } : {}),
      ...(settings.relay ? { 'fleet-relay': 'on' } : {}),
    },
  });
  const agent = host.services['fleet-agent'] as FleetAgentService;
  const addNote = (text: string) =>
    host.application.invokeRaw(
      { operation: 'notes.add', input: { text }, idempotencyKey: crypto.randomUUID() },
      owner,
    );
  /** The plant's fleet credential, as the plugin stored it. */
  const credential = () => Bun.file(join(host.workspacePath, 'fleet-agent', 'credential')).text();
  return {
    host,
    agent,
    releases,
    addNote,
    credential,
    close: async () => {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
