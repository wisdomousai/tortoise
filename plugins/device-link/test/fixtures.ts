import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import { bunSqlDriver } from '@tortoise/adapters/sqlite';
import {
  ApplicationError,
  blobRefSchema,
  defineCapability,
  defineModule,
  jsonSchema,
  type BlobRef,
} from '@tortoise/contracts';
import { createPeerPort, createTargetIntegration } from '@tortoise/integration';
import { defineApplication } from '@tortoise/kernel/application';
import { LOCAL_USER } from '@tortoise/kernel/instance';
import { defineManifest } from '@tortoise/kernel/manifest';
import type { SecretStore } from '@tortoise/kernel/platform';
import { createMobilePlatform } from '@tortoise/mobile';
import { createHandlerFactory, type EffectOutcome } from '@tortoise/runtime';
import { createHubLinkPlugin } from '@tortoise/hub-link/plugin';
import { hubLinkPluginManifest } from '@tortoise/hub-link/plugin-manifest';
import { auditPlugin } from '@tortoise/audit/plugin';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { networkPlugin } from '@tortoise/network/plugin';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
import { createDeviceLinkPlugin } from '../src/plugin';
import { deviceLinkPluginManifest } from '../src/plugin-manifest';

const photoLimits = { maxBytes: 4096, mediaTypes: ['image/jpeg'] };
const captureInput = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  note: z.string().max(200),
  photo: blobRefSchema,
});
const outcomeSchema = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().max(128).optional() }),
  z.strictObject({ status: z.literal('rejected'), code: z.string(), message: z.string() }),
]);
const empty = jsonSchema(z.strictObject({}));
const fixture = { ui: { exception: 'test fixture' } } as const;

// The hub: field devices deliver captures; the local user adds assignments that devices read.
const ingest = defineCapability({
  id: 'captures.ingest',
  kind: 'command',
  input: jsonSchema(captureInput),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'ingest', resourceType: 'Capture' },
  blobs: photoLimits,
  ...fixture,
});
const captureList = defineCapability({
  id: 'captures.list',
  kind: 'query',
  input: empty,
  output: jsonSchema(
    z.strictObject({
      captures: z.array(z.strictObject({ id: z.string(), note: z.string(), by: z.string() })),
    }),
  ),
  permission: { action: 'read', resourceType: 'Capture' },
  ...fixture,
});
const assignmentAdd = defineCapability({
  id: 'assignments.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string() })),
  output: jsonSchema(z.strictObject({ count: z.number() })),
  permission: { action: 'create', resourceType: 'Assignment' },
  ...fixture,
});
const feed = defineCapability({
  id: 'assignments.feed',
  kind: 'query',
  input: jsonSchema(z.strictObject({ cursor: z.string().optional() })),
  output: jsonSchema(
    z.strictObject({ items: z.array(z.string()), cursor: z.string(), more: z.boolean() }),
  ),
  permission: { action: 'read', resourceType: 'Assignment' },
  ...fixture,
});

type HubState = {
  captures: { id: string; note: string; by: string; photo: BlobRef }[];
  assignments: string[];
};
const hubBind = createHandlerFactory<HubState, unknown>();
const deviceOperations = new Set<string>([ingest.id, feed.id]);

/**
 * The hub application with the device-link plugin; field devices may ingest and read the feed.
 * With `deployed`, the deployment, network and audit plugins listen and record as the deployment policy says.
 */
export function hubApplication(options: { now?: () => number; deployed?: boolean } = {}) {
  const { now } = options;
  const deployment = options.deployed
    ? [
        { manifest: deploymentPluginManifest, plugin: deploymentPlugin },
        { manifest: networkPluginManifest, plugin: networkPlugin },
        { manifest: auditPluginManifest, plugin: auditPlugin },
      ]
    : [];
  return defineApplication<HubState>({
    manifest: defineManifest({
      id: 'hub',
      title: 'Hub',
      modules: [
        defineModule({ id: 'survey', capabilities: [ingest, captureList, assignmentAdd, feed] }),
      ],
      plugins: [...deployment.map((entry) => entry.manifest), deviceLinkPluginManifest],
    }),
    createState: () => ({ captures: [], assignments: [] }),
    handlers: [
      hubBind(ingest, async (input, ctx) => {
        if (input.note === 'reject')
          throw new ApplicationError('INVALID_INPUT', 'The hub refuses this capture');
        if (ctx.state.captures.some((capture) => capture.id === input.id))
          throw new ApplicationError('CONFLICT', 'Capture already ingested');
        ctx.state.captures.push({ ...input, by: ctx.context.principalId });
        ctx.change(`capture:${input.id}`);
        ctx.attach(`capture:${input.id}`, input.photo);
        return { id: input.id };
      }),
      hubBind(captureList, async (_input, ctx) => ({
        captures: ctx.state.captures.map(({ id, note, by }) => ({ id, note, by })),
      })),
      hubBind(assignmentAdd, async (input, ctx) => {
        ctx.state.assignments.push(input.title);
        ctx.change(`assignment:${ctx.state.assignments.length}`);
        return { count: ctx.state.assignments.length };
      }),
      hubBind(feed, async (input, ctx) => {
        const from = Number(input.cursor ?? '0');
        return {
          items: ctx.state.assignments.slice(from),
          cursor: String(ctx.state.assignments.length),
          more: false,
        };
      }),
    ],
    // The local user may do everything; a field device only what its grant lists, which the
    // device-link plugin narrows to the sync operations.
    authorization: {
      authorize: ({ capability, context }) => ({
        allowed:
          context.principalId === LOCAL_USER ||
          (context.principalId.startsWith('device:') && deviceOperations.has(capability.id)),
        reason: 'RESOURCE_DENIED',
      }),
      canReadEvent: ({ context }) => context.principalId === LOCAL_USER,
    },
    plugins: [
      ...deployment.map((entry) => entry.plugin),
      createDeviceLinkPlugin(now ? { now } : {}),
    ],
  });
}

// The field device: captures with a photo go to the hub through the outbox.
const record = defineCapability({
  id: 'capture.record',
  kind: 'command',
  input: jsonSchema(captureInput),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'create', resourceType: 'Capture' },
  blobs: photoLimits,
  integration: { target: 'hub', delivery: 'outbox' },
  ...fixture,
});
const fieldList = defineCapability({
  id: 'capture.list',
  kind: 'query',
  input: empty,
  output: jsonSchema(
    z.strictObject({
      captures: z.array(
        z.strictObject({ id: z.string(), sync: z.string(), code: z.string().optional() }),
      ),
      assignments: z.array(z.string()),
    }),
  ),
  permission: { action: 'read', resourceType: 'Capture' },
  ...fixture,
});
const complete = defineCapability({
  id: 'capture.complete',
  kind: 'command',
  input: jsonSchema(z.strictObject({ effectId: z.string(), outcome: outcomeSchema })),
  output: empty,
  permission: { action: 'complete', resourceType: 'Capture' },
  ...fixture,
});
const sync = defineCapability({
  id: 'assignments.sync',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ from: z.string().optional(), to: z.string(), items: z.array(z.string()) }),
  ),
  output: empty,
  permission: { action: 'sync', resourceType: 'Assignment' },
  ...fixture,
});
const status = defineCapability({
  id: 'assignments.status',
  kind: 'query',
  input: empty,
  output: jsonSchema(z.strictObject({ watermark: z.string().optional() })),
  permission: { action: 'read', resourceType: 'Assignment' },
  ...fixture,
});

type FieldState = {
  captures: { id: string; effectId: string; sync: string; code?: string }[];
  assignments: string[];
  watermark?: string;
};
const fieldBind = createHandlerFactory<FieldState, unknown>();

/** The field application with the hub-link plugin and the peer port to the paired hub. */
export function fieldApplication(options: { fetch?: typeof fetch } = {}) {
  return defineApplication<FieldState>({
    manifest: defineManifest({
      id: 'field',
      title: 'Field',
      modules: [
        defineModule({ id: 'field', capabilities: [record, fieldList, complete, sync, status] }),
      ],
      plugins: [hubLinkPluginManifest],
      targets: ['mobile'],
    }),
    createState: () => ({ captures: [], assignments: [] }),
    handlers: [
      fieldBind(record, async (input, ctx) => {
        const resource = `capture:${input.id}`;
        ctx.change(resource);
        ctx.attach(resource, input.photo);
        const effectId = ctx.enqueue({
          target: 'hub',
          type: 'captures.ingest',
          payload: input,
          resource,
        });
        ctx.state.captures.push({ id: input.id, effectId, sync: 'pending' });
        return { effectId };
      }),
      fieldBind(fieldList, async (_input, ctx) => ({
        captures: ctx.state.captures.map(({ id, sync, code }) => ({
          id,
          sync,
          ...(code ? { code } : {}),
        })),
        assignments: ctx.state.assignments,
      })),
      fieldBind(complete, async (input, ctx) => {
        const outcome: EffectOutcome = input.outcome;
        const effect = ctx.completeEffect(input.effectId, outcome);
        const capture = ctx.state.captures.find((item) => item.effectId === effect.id)!;
        capture.sync = outcome.status;
        if (outcome.status === 'rejected') capture.code = outcome.code;
        ctx.change(effect.resource);
        return {};
      }),
      fieldBind(sync, async (input, ctx) => {
        if (input.from !== ctx.state.watermark)
          throw new ApplicationError('CONFLICT', 'Stale watermark');
        ctx.state.assignments.push(...input.items);
        ctx.state.watermark = input.to;
        ctx.change('assignments:feed');
        return {};
      }),
      fieldBind(status, async (_input, ctx) => ({
        ...(ctx.state.watermark === undefined ? {} : { watermark: ctx.state.watermark }),
      })),
    ],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    connect: ({ application, workspaceId, network }) => ({
      integrations: [
        createTargetIntegration<string>({
          application,
          port: createPeerPort({
            target: 'hub',
            client: () => network.client('hub'),
            readBlob: (effect, digest) =>
              application.readEffectBlob(workspaceId, effect.id, digest),
            feed: feed.id,
          }),
          context: { workspaceId, principalId: 'integration' },
          completeOperation: complete.id,
          syncOperation: sync.id,
          statusOperation: status.id,
          toInput: (batch) => batch,
        }),
      ],
    }),
    plugins: [createHubLinkPlugin(options.fetch ? { fetch: options.fetch } : {})],
  });
}

/** A keystore in memory, standing in for the device's. */
export function memorySecrets(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

/** The mobile platform with Bun's SQLite and files, in a fresh sandbox removed by `cleanup`. */
export function devicePlatform(secrets: SecretStore = memorySecrets()) {
  const sandbox = mkdtempSync(join(tmpdir(), 'field-'));
  return {
    platform: createMobilePlatform({
      id: 'android',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
      secrets,
    }),
    cleanup: () => rmSync(sandbox, { recursive: true, force: true }),
  };
}
