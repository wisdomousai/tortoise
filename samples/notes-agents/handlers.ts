import { randomUUID } from 'node:crypto';
import { approvalHandlers, own } from '@agent-native/runtime';
import { noteOperations, type NotesServices } from '@agent-native/sample-notes/server';
import type { NotesAgentsRoot } from './domain';

/**
 * The approval operations over the `titles` slice. They read the base sample's members, so they
 * are written against the whole state instead of one slice. Only `note.update` may be requested,
 * and every member sees every request, as every member sees every note.
 */
export function createTitleHandlers() {
  return approvalHandlers<NotesAgentsRoot, NotesServices>({
    store: (state) => state.titles.approvals,
    commands: [noteOperations.noteUpdate],
    visible: (_, ctx) => own(ctx.state.notes.members, ctx.context.principalId) !== undefined,
    newId: (ctx) => (ctx.services.newId ?? randomUUID)(),
    now: (ctx) => (ctx.services.now ?? Date.now)(),
  });
}
