import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@agent-native/contracts';
import { defineFeature } from '@agent-native/host/feature';
import {
  isDelegated,
  own,
  put,
  type ExecutionContext,
  type FeatureHandler,
  type FeaturePolicy,
} from '@agent-native/runtime';
import { reviewFeatureManifest, reviewOperations, type Review } from './contracts';

/** What a caller does in the review feature. */
export type ReviewAction = 'read' | 'sign';

/**
 * The application's answer to who may do what. The application's policy never sees this
 * feature's operations, so `allows` applies the application's membership gate itself.
 */
export interface ReviewAccess {
  allows(context: ExecutionContext, action: ReviewAction): boolean;
  /**
   * The principal who wrote `subject`, or `undefined` when the subject does not exist or the
   * application keeps it from reviews.
   */
  authorOf(subject: string): string | undefined;
}

/** Application code the feature calls; each defaults when the application omits it. */
export interface ReviewHooks {
  newId?(): string;
  now?(): number;
}

/** The feature's state slice, under `review` in the application's state. */
export interface ReviewSlice {
  readonly reviews: Record<string, Review>;
}

const ops = reviewOperations;
const subjectOf = (input: unknown) => (input as { subject?: unknown }).subject;

/**
 * Reads need `read`. Signing needs `sign` under the access view of the state being committed and
 * of the previous state, a person rather than an agent run, and a subject someone else wrote.
 */
const policy: FeaturePolicy<ReviewSlice, ReviewAccess> = {
  authorize({ capability, input, context, access, previousAccess }) {
    const sign = capability.id === ops.reviewSign.id;
    if (sign && isDelegated(context)) return { allowed: false, reason: 'PERSON_ONLY' };
    const action: ReviewAction = sign ? 'sign' : 'read';
    if (
      !access.allows(context, action) ||
      (previousAccess && !previousAccess.allows(context, action))
    )
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    if (!sign) return { allowed: true };
    // The four-eyes rule: the author of a record cannot sign it.
    const subject = subjectOf(input);
    const author = typeof subject === 'string' ? access.authorOf(subject) : undefined;
    if (author === undefined) return { allowed: false, reason: 'RESOURCE_DENIED' };
    if (author === context.principalId) return { allowed: false, reason: 'SELF_REVIEW' };
    return { allowed: true };
  },
  canReadEvent: ({ event, state, context, access }) =>
    !!own(state.reviews, event.resource.slice('review:'.length)) && access.allows(context, 'read'),
};

type Handler<C extends (typeof ops)[keyof typeof ops]> = FeatureHandler<
  ReviewSlice,
  unknown,
  ReviewAccess,
  ReviewHooks,
  C
>;
const list: Handler<typeof ops.reviewList> = {
  capability: ops.reviewList,
  handle: (input, ctx) => ({
    items: Object.values(ctx.state.reviews)
      .filter((review) => review.subject === input.subject)
      .sort((a, b) => b.reviewedAt - a.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }),
};
const sign: Handler<typeof ops.reviewSign> = {
  capability: ops.reviewSign,
  handle: (input, ctx) => {
    const reviewer = ctx.context.principalId;
    // The revision the reviewer read; a caller that passes it in expectedRevisions gets
    // CONFLICT instead of a signature when the record changed in between.
    const revision = ctx.getRevision(input.subject);
    // One signature per reviewer and revision: a changed record can be signed again.
    if (
      Object.values(ctx.state.reviews).some(
        (review) =>
          review.subject === input.subject &&
          review.revision === revision &&
          review.reviewer === reviewer,
      )
    )
      throw new ApplicationError('CONFLICT', 'You have already signed this revision');
    const id = ctx.hooks.newId?.() ?? randomUUID();
    const review: Review = {
      id,
      subject: input.subject,
      revision,
      verdict: input.verdict,
      comment: input.comment ?? '',
      reviewer,
      reviewedAt: ctx.hooks.now?.() ?? Date.now(),
    };
    put(ctx.state.reviews, id, review);
    ctx.change(`review:${id}`);
    return review;
  },
};

/**
 * A four-eyes review: people other than a record's author approve or reject it at a revision.
 * Signatures live in the `review` slice. Mount it with `mountFeature(reviewFeature(), { access,
 * hooks })`; the access view names the author of each subject.
 */
export function reviewFeature() {
  return defineFeature<ReviewSlice, ReviewAccess, ReviewHooks>({
    manifest: reviewFeatureManifest,
    state: { create: () => ({ reviews: {} }) },
    handlers: [list, sign],
    authorization: { resourceTypes: ['review'], port: policy },
  });
}
