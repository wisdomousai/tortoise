import { ApplicationError } from '@agent-native/contracts';
import {
  createHandlerFactory,
  own,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { byKind } from '@agent-native/assignments/server';
import { noteOperations } from '@agent-native/sample-notes/contracts';
import type { NotesServices } from '@agent-native/sample-notes/server';
import { reviewer, reviewOperations } from './contracts';
import type { NotesAssignmentsRoot } from './domain';

type Context = HandlerContext<NotesAssignmentsRoot, NotesServices>;
const bind = createHandlerFactory<NotesAssignmentsRoot, NotesServices>();
const noteOf = (ctx: Context, id: string) => own(ctx.state.notes.notes, id);
const notesIn = (scope: Record<string, unknown>) => scope.notes as string[];

/** The members, then the reviewer agent. */
export function createReviewHandlers(): HandlerContribution<NotesAssignmentsRoot, NotesServices>[] {
  return [
    bind(reviewOperations.assigneeList, (_input, ctx) => ({
      items: [
        ...Object.entries(ctx.state.notes.members)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([id, role]) => ({ type: 'person' as const, id, label: `${id} (${role})` })),
        { type: 'agent' as const, id: reviewer.id, label: reviewer.title },
      ],
    })),
  ];
}

/**
 * The review kind's hooks. The scope names notes that exist; the brief is their title and text
 * when the assignment is sent; a report is about one of them; accepting it adds its comment, or
 * the reviewer's, to the note through `note.update`, as the person accepting.
 */
export const reviewHooks = {
  newId: (ctx: Context) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
  now: (ctx: Context) => (ctx.services.now ?? Date.now)(),
  ...byKind<Context>({
    review: {
      scope: (scope, ctx) => {
        for (const id of notesIn(scope))
          if (!noteOf(ctx, id))
            throw new ApplicationError('INVALID_INPUT', `No note ${id}`, { field: 'scope' });
      },
      brief: (assignment, ctx) => ({
        notes: notesIn(assignment.scope).flatMap((id) => {
          const note = noteOf(ctx, id);
          return note ? [{ id, title: note.title, text: note.text }] : [];
        }),
      }),
      subject: (subject, assignment) => notesIn(assignment.scope).includes(subject),
      accept: async (report, input, _assignment, ctx) => {
        if (!report.subject)
          throw new ApplicationError('CONFLICT', 'Place the report on a note before accepting it');
        const note = noteOf(ctx, report.subject);
        if (!note) throw new ApplicationError('CONFLICT', 'The note is no longer there');
        const comment = (input.comment as string | undefined) ?? (report.body.comment as string);
        await ctx.invoke(noteOperations.noteUpdate, {
          id: note.id,
          text: `${note.text}\n\nReview (${String(report.body.verdict)}): ${comment}`,
        });
      },
    },
  }),
};
