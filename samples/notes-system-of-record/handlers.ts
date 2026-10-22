import { ApplicationError } from '@agent-native/contracts';
import { settleDelivery, targetHandlers } from '@agent-native/integration';
import {
  collectionGetHandler,
  collectionListHandler,
  createHandlerFactory,
  own,
  reconciliationHandlers,
  records,
  type Effect,
  type EffectOutcome,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { notes, type NotesServices } from '@agent-native/sample-notes/server';
import {
  publications,
  publisherTarget,
  publishingOperations,
  type PostedNote,
  type Publication,
} from './contracts';
import { PUBLISHER_PRINCIPAL, type NotesPublishingRoot } from './domain';

type Context = HandlerContext<NotesPublishingRoot, NotesServices>;
const bind = createHandlerFactory<NotesPublishingRoot, NotesServices>();
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const store = (state: NotesPublishingRoot) => state.publishing.publications;
const publicationsOf = (ctx: Context) => records(ctx, publications, store(ctx.state));
/** Members see every publication, as they see every note; the policy keeps others out. */
const visible = () => true;

/** The effect type of one published note. */
export const publishNote = 'note.publish';

/** An outcome lands on the publication that forwarded the effect, and nowhere else. */
function recordOutcome(effect: Effect, outcome: EffectOutcome, ctx: Context) {
  const id = effect.resource.slice(`${publications.type}:`.length);
  publicationsOf(ctx).update(id, (publication) => {
    settleDelivery(publication, effect, outcome);
  });
}

/**
 * Publishing, the publisher target's settle, sync and status, and reconciliation of held
 * publications. They read the base sample's notes, so they are written against the whole state.
 */
export function createPublishingHandlers(): HandlerContribution<
  NotesPublishingRoot,
  NotesServices
>[] {
  return [
    collectionListHandler(publications, publishingOperations.publicationList, {
      store,
      visible,
      order: (a, b) => b.publishedAt - a.publishedAt,
    }),
    collectionGetHandler(publications, publishingOperations.publicationGet, {
      store,
      visible,
    }),
    bind(publishingOperations.publicationPublish, (input, ctx) => {
      const note = own(ctx.state.notes.notes, input.id);
      if (!note) throw new ApplicationError('NOT_FOUND', 'Note unavailable');
      // One delivery at a time per note, so a late outcome never lands on a newer one.
      if (own(store(ctx.state), input.id)?.sync === 'pending')
        throw new ApplicationError('CONFLICT', 'The publisher has not decided the last one yet');
      const effectId = ctx.enqueue({
        target: publisherTarget.target,
        type: publishNote,
        resource: publications.resource(note.id),
        payload: { noteId: note.id, title: note.title, text: note.text },
      });
      return publicationsOf(ctx).set(note.id, {
        id: note.id,
        title: note.title,
        effectId,
        sync: 'pending',
        publishedAt: now(ctx),
      });
    }),
    ...targetHandlers<NotesPublishingRoot, NotesServices, PostedNote>(publisherTarget, {
      cursor: (state) => state.publishing.sync,
      now,
      onOutcome: recordOutcome,
      // A note posted on the site becomes a note here once; a later copy changes nothing.
      applyBatch(batch, ctx) {
        const local = records(ctx, notes, ctx.state.notes.notes);
        let added = 0;
        for (const posted of batch.items) {
          const id = `site-${posted.id}`;
          if (local.has(id)) continue;
          local.insert(id, {
            id,
            title: posted.title,
            text: posted.text,
            author: PUBLISHER_PRINCIPAL,
            updatedAt: now(ctx),
          });
          added++;
        }
        return added;
      },
      status(ctx) {
        const all = Object.values(store(ctx.state));
        const count = (sync: Publication['sync']) =>
          all.filter((publication) => publication.sync === sync).length;
        return {
          pending: count('pending'),
          accepted: count('accepted'),
          rejected: count('rejected'),
        };
      },
    }),
    ...reconciliationHandlers<NotesPublishingRoot, NotesServices>({
      visible: (effect) => effect.resource.startsWith(`${publications.type}:`),
      // Applied or refused lands on the publication as the publisher's own answer would; a
      // publication sent again stays pending.
      onResolved(effect, _decision, outcome, ctx) {
        if (outcome) recordOutcome(effect, outcome, ctx);
      },
    }),
  ];
}
