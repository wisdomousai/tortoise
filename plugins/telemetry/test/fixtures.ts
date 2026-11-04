import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
} from '@tortoise/contracts';
import { auditPlugin } from '@tortoise/audit/plugin';
import { auditPluginManifest } from '@tortoise/audit/plugin-manifest';
import { defineApplication } from '@tortoise/kernel/application';
import { LOCAL_OWNER } from '@tortoise/kernel/instance';
import { defineManifest } from '@tortoise/kernel/manifest';
import { networkPlugin } from '@tortoise/network/plugin';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { createHandlerFactory, type EffectOutcome } from '@tortoise/runtime';
import { deploymentPlugin } from '@tortoise/deployment/plugin';
import { deploymentPluginManifest } from '@tortoise/deployment/plugin-manifest';
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
const noteComplete = defineCapability({
  id: 'note.complete',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ effectId: z.string(), status: z.enum(['accepted', 'rejected']) }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'complete', resourceType: 'Note' },
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

type State = { notes: Record<string, string> };
const bind = createHandlerFactory<State, unknown>();

/** An application whose one command writes a note and sends it to the `erp` target. */
export function telemetryApplication() {
  return defineApplication<State>({
    manifest: defineManifest({
      id: 'plant',
      title: 'Plant',
      modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteComplete] })],
      components: [erp],
      plugins: [
        deploymentPluginManifest,
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
      bind(noteComplete, async (input, ctx) => {
        const outcome: EffectOutcome =
          input.status === 'accepted'
            ? { status: 'accepted' }
            : { status: 'rejected', code: 'DUPLICATE', message: 'Already there' };
        ctx.change(ctx.completeEffect(input.effectId, outcome).resource);
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
      deploymentPlugin,
      networkPlugin,
      auditPlugin,
      createTelemetryPlugin({ intervalMs: 3_600_000, maxSpans: 8 }),
    ],
  });
}

export { startCollector, type Received } from '../src/testing';
