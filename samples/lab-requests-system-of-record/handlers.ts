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
import { testRequests, type LabRequestsServices } from '@agent-native/sample-lab-requests/server';
import {
  limsTarget,
  publications,
  publishingOperations,
  type Publication,
  type RegisteredRequest,
} from './contracts';
import { LIMS_PRINCIPAL, type LabPublishingRoot } from './domain';

type Context = HandlerContext<LabPublishingRoot, LabRequestsServices>;
const bind = createHandlerFactory<LabPublishingRoot, LabRequestsServices>();
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();
const store = (state: LabPublishingRoot) => state.publishing.publications;
const publicationsOf = (ctx: Context) => records(ctx, publications, store(ctx.state));
/** Members see every publication, as they see every test request; the policy keeps others out. */
const visible = () => true;

/** The effect type of one test request registered in the LIMS. */
export const publishRequest = 'test-request.publish';

/** An outcome lands on the publication that forwarded the effect, and nowhere else. */
function recordOutcome(effect: Effect, outcome: EffectOutcome, ctx: Context) {
  const id = effect.resource.slice(`${publications.type}:`.length);
  publicationsOf(ctx).update(id, (publication) => {
    settleDelivery(publication, effect, outcome);
  });
}

/**
 * Publishing, the LIMS target's settle, sync and status, and reconciliation of held
 * publications. They read the base sample's test requests, so they are written against the
 * whole state.
 */
export function createPublishingHandlers(): HandlerContribution<
  LabPublishingRoot,
  LabRequestsServices
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
      const request = own(ctx.state.labRequests.requests, input.id);
      if (!request) throw new ApplicationError('NOT_FOUND', 'Test request unavailable');
      // One delivery at a time per request, so a late outcome never lands on a newer one.
      if (own(store(ctx.state), input.id)?.sync === 'pending')
        throw new ApplicationError('CONFLICT', 'The LIMS has not decided the last one yet');
      const effectId = ctx.enqueue({
        target: limsTarget.target,
        type: publishRequest,
        resource: publications.resource(request.id),
        payload: {
          requestId: request.id,
          specimen: request.specimen,
          description: request.description,
          method: request.method,
        },
      });
      return publicationsOf(ctx).set(request.id, {
        id: request.id,
        specimen: request.specimen,
        effectId,
        sync: 'pending',
        publishedAt: now(ctx),
      });
    }),
    ...targetHandlers<LabPublishingRoot, LabRequestsServices, RegisteredRequest>(limsTarget, {
      cursor: (state) => state.publishing.sync,
      now,
      onOutcome: recordOutcome,
      // A request registered at another site becomes a test request here once; a later copy
      // changes nothing.
      applyBatch(batch, ctx) {
        const local = records(ctx, testRequests, ctx.state.labRequests.requests);
        let added = 0;
        for (const registered of batch.items) {
          const id = `lims-${registered.id}`;
          if (local.has(id)) continue;
          local.insert(id, {
            id,
            specimen: registered.specimen,
            description: registered.description,
            method: registered.method,
            requester: LIMS_PRINCIPAL,
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
    ...reconciliationHandlers<LabPublishingRoot, LabRequestsServices>({
      visible: (effect) => effect.resource.startsWith(`${publications.type}:`),
      // Applied or refused lands on the publication as the LIMS's own answer would; a
      // publication sent again stays pending.
      onResolved(effect, _decision, outcome, ctx) {
        if (outcome) recordOutcome(effect, outcome, ctx);
      },
    }),
  ];
}
