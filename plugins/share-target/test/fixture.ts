import { z } from 'zod';
import {
  blobRefSchema,
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
import { createShareTargetPlugin } from '../src/plugin';
import { shareTargetPluginManifest } from '../src/plugin-manifest';

// A fixture application: notes prefilled from a shared link, shared text or a shared scan.
export const scheme = 'dev.example.notes';
const noteCreate = defineCapability({
  id: 'notes.create',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      title: z.string().max(40).optional(),
      body: z.string().max(200).optional(),
      scan: blobRefSchema.optional(),
    }),
  ),
  output: jsonSchema(z.strictObject({})),
  permission: { action: 'write', resourceType: 'Note' },
  ui: { binding: 'notes.create' },
  blobs: { maxBytes: 64, mediaTypes: ['application/pdf'] },
});
const handlers: OsHandler[] = [
  {
    id: 'note.from-shared-link',
    kind: 'share',
    description: 'A note from a shared link.',
    accepts: { url: true },
    maxBytes: 2048,
    target: { prepare: 'notes.create', input: { body: '{url}' } },
  },
  {
    id: 'note.from-shared-scan',
    kind: 'share',
    description: 'A note from a shared scan.',
    accepts: { mediaTypes: ['application/pdf'] },
    maxBytes: 64,
    target: { prepare: 'notes.create', input: { title: '{title}', scan: '{blob}' } },
  },
  {
    id: 'note.from-shared-text',
    kind: 'share',
    description: 'A note from shared text.',
    accepts: { text: true },
    maxBytes: 200,
    target: { prepare: 'notes.create', input: { body: '{text}' } },
  },
];
const actions: OsAction[] = [
  {
    id: 'notes.share',
    kind: 'share',
    description: 'Share a note as text.',
    accepts: { text: true, url: true },
    dataClasses: ['note-text'],
  },
];

/** The notes application with the OS plugin and, unless `share` is false, the share target. */
export function notesApplication(options: { share?: boolean; now?: () => number } = {}) {
  const share = options.share !== false;
  return defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'notes',
      title: 'Notes',
      modules: [
        defineModule({ id: 'notes', capabilities: [noteCreate], os: { handlers, actions } }),
      ],
      plugins: [osPluginManifest, ...(share ? [shareTargetPluginManifest] : [])],
      targets: ['desktop', 'mobile'],
    }),
    createState: () => ({}),
    handlers: [{ capability: noteCreate, handle: async () => ({}) }],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    plugins: [
      createOsPlugin(),
      ...(share ? [createShareTargetPlugin(options.now ? { now: options.now } : {})] : []),
    ],
  });
}
