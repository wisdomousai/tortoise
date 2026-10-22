import { randomUUID } from 'node:crypto';
import {
  collectionGetHandler,
  collectionListHandler,
  createHandlerFactory,
  records,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { noteOperations, notes, type Note } from './contracts';
import type { NotesState } from './domain';

export interface NotesServices {
  /** Note ids; random UUIDs when omitted. */
  newId?: () => string;
  /** Instance clock for `updatedAt`. */
  now?: () => number;
}
type Context = HandlerContext<NotesState, NotesServices>;

const bind = createHandlerFactory<NotesState, NotesServices>();
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const notesOf = (ctx: Context) => records(ctx, notes, ctx.state.notes);
/** Every member sees every note; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: NotesState) => state.notes;

/**
 * The handlers of the notes module, written against the notes slice. An application that
 * composes the module passes them through `sliceHandlers('notes', ...)`.
 */
export function createNotesHandlers(): HandlerContribution<NotesState, NotesServices>[] {
  return [
    collectionListHandler<NotesState, NotesServices, typeof noteOperations.noteList, Note>(
      notes,
      noteOperations.noteList,
      {
        store,
        visible,
        order: (a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        searchText: (note) => `${note.title} ${note.text}`,
      },
    ),
    collectionGetHandler<NotesState, NotesServices, typeof noteOperations.noteGet, Note>(
      notes,
      noteOperations.noteGet,
      { store, visible },
    ),
    bind(noteOperations.noteAdd, (input, ctx) => {
      const id = (ctx.services.newId ?? randomUUID)();
      return notesOf(ctx).insert(id, {
        id,
        title: input.title,
        text: input.text,
        author: ctx.context.principalId,
        updatedAt: now(ctx),
      });
    }),
    bind(noteOperations.noteUpdate, (input, ctx) =>
      notesOf(ctx).update(input.id, (note) => {
        if (input.title !== undefined) note.title = input.title;
        if (input.text !== undefined) note.text = input.text;
        note.updatedAt = now(ctx);
      }),
    ),
  ];
}
