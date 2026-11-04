import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  type OsAction,
  type OsHandler,
} from '@tortoise/contracts';
import { defineApplication } from '@tortoise/kernel/application';
import { defineManifest } from '@tortoise/kernel/manifest';
import { createOsPlugin } from '@tortoise/os/plugin';
import { osPluginManifest } from '@tortoise/os/plugin-manifest';
import { androidIntentsPlugin } from '../src/plugin';
import { androidIntentsPluginManifest } from '../src/plugin-manifest';

// A fixture application: another app asks for a note with an intent, and a note asks a scanner
// app for a scan with an explicit intent.
export const scheme = 'dev.example.notes';
export const createAction = 'dev.example.notes.action.CREATE';
const noteCreate = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({ title: z.string().max(40).optional(), body: z.string().max(200).optional() }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
});
const handlers: OsHandler[] = [
  {
    id: 'note.from-intent',
    kind: 'intent',
    description: 'A note another app asks for.',
    action: createAction,
    extras: jsonSchema(
      z.strictObject({ title: z.string().max(40), copies: z.number().optional() }),
    ),
    target: { prepare: 'notes.create', input: { title: '{title}', body: '{data}' } },
  },
];
const actions: OsAction[] = [
  {
    id: 'notes.scan',
    kind: 'intent',
    description: 'Ask the scanner app for a scan.',
    action: 'com.example.scanner.action.SCAN',
    package: 'com.example.scanner',
    extras: jsonSchema(
      z.strictObject({ prompt: z.string().max(80), copies: z.number().int().min(1).max(3) }),
    ),
    dataClasses: ['note-title'],
  },
];

/** The notes application with the OS plugin and, unless `intents` is false, Android intents. */
export function notesApplication(options: { intents?: boolean } = {}) {
  const intents = options.intents !== false;
  return defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [
        defineModule({ id: 'notes', capabilities: [noteCreate], os: { handlers, actions } }),
      ],
      plugins: [osPluginManifest, ...(intents ? [androidIntentsPluginManifest] : [])],
      targets: ['desktop', 'mobile'],
    }),
    createState: () => ({}),
    handlers: [{ capability: noteCreate, handle: async () => ({}) }],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    plugins: [createOsPlugin(), ...(intents ? [androidIntentsPlugin] : [])],
  });
}
