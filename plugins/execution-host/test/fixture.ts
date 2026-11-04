import { z } from 'zod';
import {
  defineCapability,
  defineHostComponent,
  defineModule,
  jsonSchema,
} from '@tortoise/contracts';
import { defineApplication } from '@tortoise/host/application';
import { defineManifest } from '@tortoise/host/manifest';
import { networkPlugin } from '@tortoise/network/plugin';
import { networkPluginManifest } from '@tortoise/network/plugin-manifest';
import { processPlugin } from '@tortoise/process/plugin';
import { processPluginManifest } from '@tortoise/process/plugin-manifest';
import {
  put,
  type AuthorizationPort,
  type ExecutionContext,
  type HandlerContext,
} from '@tortoise/runtime';
import { sitePlugin } from '@tortoise/site/plugin';
import { sitePluginManifest } from '@tortoise/site/plugin-manifest';
import { executionSandbox } from '../src/contracts';
import { createExecutionHostPlugin } from '../src/plugin';
import { executionHostPluginManifest } from '../src/plugin-manifest';
import type { ExecutionHostOptions } from '../src/run';

// A fixture application: notes that members add and list, for a sandboxed task to work on.
const fixture = { ui: { exception: 'test fixture' } } as const;
const noteSchema = z.strictObject({ id: z.string(), text: z.string() });
export const noteAdd = defineCapability({
  id: 'note.add',
  kind: 'command',
  input: jsonSchema(noteSchema),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ...fixture,
});
export const noteList = defineCapability({
  id: 'note.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ items: z.array(noteSchema) })),
  permission: { action: 'read', resourceType: 'Note' },
  ...fixture,
});
const notesModule = defineModule({ id: 'notes', capabilities: [noteAdd, noteList] });

interface Notes {
  notes: Record<string, { id: string; text: string }>;
}
type Ctx = HandlerContext<{ notes: Notes }, unknown>;
const handlers = [
  {
    capability: noteAdd,
    handle(input: { id: string; text: string }, ctx: Ctx) {
      put(ctx.state.notes.notes, input.id, input);
      ctx.change(`note:${input.id}`, 'created');
      return {};
    },
  },
  {
    capability: noteList,
    handle: (_input: object, ctx: Ctx) => ({ items: Object.values(ctx.state.notes.notes) }),
  },
];
// Members are ann and bob; the delegation grant narrows what a sandbox acting for them may do.
const policy: AuthorizationPort<{ notes: Notes }> = {
  authorize: ({ context }) => ({ allowed: ['ann', 'bob'].includes(context.principalId) }),
  canReadEvent: () => true,
};

/** The vendor API a sandboxed tool may reach through the egress proxy. */
const modelApi = defineHostComponent({
  id: 'model-api',
  description: 'The model API sandboxed tools call',
  requirements: {
    network: [
      {
        id: 'model-api',
        purpose: 'Model calls from sandboxed tools',
        direction: 'egress',
        scope: 'loopback',
        protocol: 'tcp',
        dataClasses: ['prompts'],
        availability: 'optional',
        offline: 'degrade',
      },
    ],
  },
});

export const person = (principalId: string): ExecutionContext => ({
  workspaceId: 'local',
  principalId,
});

/** The notes application with a networked sandbox (`sandbox`) and one without (`offline`). */
export function notesApplication(options: ExecutionHostOptions) {
  return defineApplication<{ notes: Notes }>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [notesModule],
      components: [
        modelApi,
        executionSandbox({ id: 'sandbox', description: 'Tools for tests', network: ['model-api'] }),
        executionSandbox({ id: 'offline', description: 'Tools without network' }),
      ],
      plugins: [
        sitePluginManifest,
        networkPluginManifest,
        processPluginManifest,
        executionHostPluginManifest,
      ],
    }),
    createState: () => ({ notes: { notes: {} } }),
    handlers: handlers as never,
    authorization: policy,
    plugins: [sitePlugin, networkPlugin, processPlugin, createExecutionHostPlugin(options)],
  });
}
