import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
} from '@agent-native/contracts';
import { auditPlugin } from '@agent-native/audit/plugin';
import { auditPluginManifest } from '@agent-native/audit/plugin-manifest';
import { defineApplication } from '@agent-native/kernel/application';
import { LOCAL_OWNER } from '@agent-native/kernel/authority';
import { defineManifest } from '@agent-native/kernel/manifest';
import { networkPlugin } from '@agent-native/network/plugin';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { createHandlerFactory, type EffectOutcome } from '@agent-native/runtime';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { createTelemetryPlugin } from '../src/plugin';
import { telemetryPluginManifest } from '../src/plugin-manifest';

const noteAdd = defineCapability({
  id: 'note.add',
  kind: 'command',
  input: jsonSchema(z.strictObject({ text: z.string() })),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
const noteSettle = defineCapability({
  id: 'note.settle',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ effectId: z.string(), status: z.enum(['accepted', 'rejected']) }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'settle', resourceType: 'Note' },
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

type State = { notes: Record<string, string> };
const bind = createHandlerFactory<State, unknown>();

/** An application whose one command writes a note and sends it to the `erp` target. */
export function telemetryApplication() {
  return defineApplication<State>({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteSettle] })],
      components: [erp],
      plugins: [
        sitePluginManifest,
        networkPluginManifest,
        auditPluginManifest,
        telemetryPluginManifest,
      ],
    }),
    createState: () => ({ notes: {} }),
    handlers: [
      bind(noteAdd, async (input, ctx) => {
        const id = `note-${Object.keys(ctx.state.notes).length + 1}`;
        ctx.state.notes[id] = input.text;
        ctx.change(`note:${id}`);
        ctx.enqueue({
          target: 'erp',
          type: 'note.created',
          resource: `note:${id}`,
          payload: { text: input.text },
        });
        return { id };
      }),
      bind(noteSettle, async (input, ctx) => {
        const outcome: EffectOutcome =
          input.status === 'accepted'
            ? { status: 'accepted' }
            : { status: 'rejected', code: 'DUPLICATE', message: 'Already there' };
        ctx.change(ctx.settleEffect(input.effectId, outcome).resource);
        return {};
      }),
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
      networkPlugin,
      auditPlugin,
      createTelemetryPlugin({ intervalMs: 3_600_000, maxSpans: 8 }),
    ],
  });
}

export interface Received {
  readonly path: string;
  readonly body: Record<string, any>;
}

/** An OTLP/HTTP collector on loopback that keeps what it receives and can refuse. */
export function startCollector() {
  const received: Received[] = [];
  const control = { down: false };
  const receive = async (request: Request) => {
    if (control.down) return new Response('unavailable', { status: 503 });
    received.push({
      path: new URL(request.url).pathname,
      body: (await request.json()) as Record<string, any>,
    });
    return Response.json({});
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: receive });
  return {
    url: `http://127.0.0.1:${server.port}`,
    received,
    control,
    stop: () => server.stop(true),
  };
}
