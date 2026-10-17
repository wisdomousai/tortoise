import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  type OsHandler,
} from '@agent-native/contracts';
import { defineApplication } from '@agent-native/kernel/application';
import { defineManifest } from '@agent-native/kernel/manifest';
import { createOsPlugin } from '@agent-native/os/plugin';
import { osPluginManifest } from '@agent-native/os/plugin-manifest';
import { osShortcutsPlugin } from '../src/plugin';
import { osShortcutsPluginManifest } from '../src/plugin-manifest';

// A fixture application: a launcher entry opens an empty new note.
export const scheme = 'dev.example.notes';
const noteCreate = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ title: z.string().max(40).optional() })),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
});
const handlers: OsHandler[] = [
  {
    id: 'note.new',
    kind: 'shortcut',
    description: 'A new note from the launcher.',
    title: 'New note',
    target: { prepare: 'notes.create', input: {} },
  },
  {
    id: 'note.open',
    kind: 'link',
    description: 'Open a note.',
    path: '/notes/:noteId',
    params: jsonSchema(z.strictObject({ noteId: z.string() })),
    target: { screen: 'notes', search: { note: '{noteId}' } },
  },
];

/** The notes application with the OS plugin and, unless `shortcuts` is false, OS shortcuts. */
export function notesApplication(options: { shortcuts?: boolean } = {}) {
  const shortcuts = options.shortcuts !== false;
  return defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [defineModule({ id: 'notes', capabilities: [noteCreate], os: { handlers } })],
      plugins: [osPluginManifest, ...(shortcuts ? [osShortcutsPluginManifest] : [])],
      targets: ['desktop', 'mobile'],
    }),
    createState: () => ({}),
    handlers: [{ capability: noteCreate, handle: async () => ({}) }],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    plugins: [createOsPlugin(), ...(shortcuts ? [osShortcutsPlugin] : [])],
  });
}
