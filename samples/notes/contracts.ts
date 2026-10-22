import { z } from 'zod';
import {
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/** One note. `author` is the principal who added it. */
export const noteSchema = z.strictObject({
  id: recordKeySchema,
  title: z.string().max(200),
  text: z.string().max(10_000),
  author: z.string().min(1).max(128),
  updatedAt: z.number().int().nonnegative(),
});
export type Note = z.output<typeof noteSchema>;

export const notes = defineCollection({
  type: 'note',
  resourceType: 'Note',
  item: noteSchema,
  label: { one: 'Note', many: 'Notes' },
  titleField: 'title',
  fields: [
    { name: 'title' },
    { name: 'text' },
    { name: 'author', label: 'Added by' },
    { name: 'updatedAt', label: 'Changed' },
  ],
});

const write = { action: 'write', resourceType: 'Note' };

/** Reading, adding and changing notes. Browser-safe. */
export const noteOperations = {
  noteList: collectionList(notes, {
    id: 'note',
    description: 'List notes, most recently changed first. Search matches title and text.',
    search: true,
  }),
  noteGet: collectionGet(notes, {
    id: 'note',
    description: 'Read one note by id. Use its revision as note:<id> in expectedRevisions.',
  }),
  noteAdd: defineCapability({
    id: 'note.add',
    kind: 'command',
    description: 'Add a note. Editors only. The title may be empty.',
    input: jsonSchema(
      z.strictObject({ title: noteSchema.shape.title, text: noteSchema.shape.text }),
    ),
    output: jsonSchema(noteSchema),
    permission: write,
    dependencies: ['note'],
    ui: { binding: 'note.add' },
    display: { label: 'Add note', resource: 'note', titleField: 'title' },
  }),
  noteUpdate: defineCapability({
    id: 'note.update',
    kind: 'command',
    description:
      'Change the title or text of a note. Editors only. Pass the revision you read as expectedRevisions so a concurrent change conflicts.',
    input: jsonSchema(
      z.strictObject({
        id: recordKeySchema,
        title: noteSchema.shape.title.optional(),
        text: noteSchema.shape.text.optional(),
      }),
    ),
    output: jsonSchema(noteSchema),
    permission: write,
    dependencies: ['note'],
    ui: { binding: 'note.update' },
    display: { label: 'Save note', resource: 'note', titleField: 'title' },
  }),
} as const;

export const notesModule = defineModule({
  id: 'notes',
  capabilities: Object.values(noteOperations),
  workflows: [
    {
      id: 'notes.edit',
      operations: ['note.list', 'note.get', 'note.update'],
      text: 'Find the note with note.list, read it with note.get, then call note.update with the revision you read as expectedRevisions.',
    },
  ],
});
