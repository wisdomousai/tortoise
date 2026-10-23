/**
 * What an application that composes the notes module imports: the module, its handlers, its
 * policy and its state. The extensions in `samples/*` import these unchanged.
 */
export {
  notesModule,
  noteOperations,
  notes,
  noteSchema,
  noteRecordSchema,
  type Note,
  type NoteRecord,
} from './contracts';
export { createNotesState, type NotesState, type Role } from './domain';
export { createNotesHandlers, type NotesServices } from './handlers';
export { notesPolicy } from './policy';
