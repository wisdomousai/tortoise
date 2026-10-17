import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';
import { defineManifest } from '@agent-native/kernel/manifest';

/** A minimal mobile application for the starter's own checks: notes added and listed. */
export const noteAdd = defineCapability({
  id: 'note.add',
  kind: 'command',
  description: 'Add a note.',
  input: jsonSchema(z.strictObject({ text: z.string().min(1).max(500) })),
  output: jsonSchema(z.strictObject({ id: z.string() })),
  permission: { action: 'create', resourceType: 'note' },
  ui: { exception: 'starter fixture' },
});
export const noteList = defineCapability({
  id: 'note.list',
  kind: 'query',
  description: 'The notes, newest first.',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(
    z.strictObject({ notes: z.array(z.strictObject({ id: z.string(), text: z.string() })) }),
  ),
  permission: { action: 'read', resourceType: 'note' },
  dependencies: ['note'],
  ui: { exception: 'starter fixture' },
});

export default defineManifest({
  id: 'mobile-fixture',
  title: 'Notes',
  modules: [defineModule({ id: 'notes', capabilities: [noteAdd, noteList] })],
  targets: ['mobile'],
});
