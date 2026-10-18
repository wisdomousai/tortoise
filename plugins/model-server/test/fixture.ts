import { z } from 'zod';
import {
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  approvalOperations,
  type ApprovalRequest,
} from '@agent-native/contracts';
import { defineApplication } from '@agent-native/host/application';
import { defineManifest } from '@agent-native/host/manifest';
import { networkPlugin } from '@agent-native/network/plugin';
import { networkPluginManifest } from '@agent-native/network/plugin-manifest';
import { processPlugin } from '@agent-native/process/plugin';
import { processPluginManifest } from '@agent-native/process/plugin-manifest';
import {
  approvalHandlers,
  put,
  type ExecutionContext,
  type HandlerContext,
} from '@agent-native/runtime';
import { sitePlugin } from '@agent-native/site/plugin';
import { sitePluginManifest } from '@agent-native/site/plugin-manifest';
import { modelServer } from '../src/contracts';
import { createModelServer, type ModelServerOptions } from '../src/plugin';
import { modelServerPluginManifest } from '../src/plugin-manifest';

// A fixture application: notes, and an agent that requests approval for notes on the fine-tuned model only.
const noteSchema = z.strictObject({ id: z.string(), text: z.string() });
export const noteAdd = defineCapability({
  id: 'note.add',
  kind: 'command',
  input: jsonSchema(noteSchema),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'note.add' },
});
export const noteList = defineCapability({
  id: 'note.list',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({ items: z.array(noteSchema) })),
  permission: { action: 'read', resourceType: 'Note' },
  ui: { exception: 'test fixture' },
});
export const ENTRY = 'notes-tuned';
const notesModule = defineModule({
  id: 'notes',
  capabilities: [noteAdd, noteList, ...Object.values(approvalOperations)],
  agents: [
    defineAgent({
      id: 'note.suggester',
      title: 'Note suggester',
      instructions: 'Request approval for one note.',
      operations: ['note.list', 'note.add'],
      model: 'local',
      models: [ENTRY],
      output: 'request-approval',
      // A local model that reasons before it calls a tool takes tens of seconds per turn on a laptop.
      budgets: { turns: 4, toolCalls: 4, wallTimeMs: 120_000 },
    }),
  ],
});

interface State {
  notes: {
    notes: Record<string, { id: string; text: string }>;
    approvals: Record<string, ApprovalRequest>;
  };
}
type Ctx = HandlerContext<State, unknown>;
let ids = 0;
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
    handle: (_: object, ctx: Ctx) => ({ items: Object.values(ctx.state.notes.notes) }),
  },
  ...approvalHandlers<State, unknown>({
    store: (state) => state.notes.approvals,
    commands: [noteAdd],
    visible: () => true,
    newId: () => `p${++ids}`,
    now: () => Date.now(),
  }),
];

export const person: ExecutionContext = { workspaceId: 'local', principalId: 'ann' };

export function notesApplication(options: ModelServerOptions) {
  const models = createModelServer(options);
  const application = defineApplication<State>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [notesModule],
      components: [modelServer({ id: 'llm', runtime: 'llama-server' })],
      plugins: [
        sitePluginManifest,
        networkPluginManifest,
        processPluginManifest,
        modelServerPluginManifest,
      ],
    }),
    createState: () => ({ notes: { notes: {}, approvals: {} } }),
    handlers: handlers as never,
    authorization: {
      authorize: ({ context }) => ({ allowed: context.principalId === 'ann' }),
      canReadEvent: () => true,
    },
    plugins: [sitePlugin, networkPlugin, processPlugin, models.plugin],
  });
  return { application, models };
}
