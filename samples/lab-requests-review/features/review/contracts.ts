import { z } from 'zod';
import {
  defineCapability,
  defineFeatureManifest,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';

/**
 * One signature on a record. `subject` is the journal resource signed, such as
 * `test-request:r1`, and `revision` is its revision when it was signed, so a later change to the
 * record leaves the signature on the earlier revision.
 */
export const reviewSchema = z.strictObject({
  id: recordKeySchema,
  subject: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  verdict: z.enum(['approved', 'rejected']),
  comment: z.string().max(2_000),
  reviewer: z.string(),
  reviewedAt: z.number().int().nonnegative(),
});
export type Review = z.output<typeof reviewSchema>;

/** The review feature's operations. Browser-safe; every ID starts with `review.`. */
export const reviewOperations = {
  reviewList: defineCapability({
    id: 'review.list',
    kind: 'query',
    description: 'List the signatures on one record, newest first.',
    input: jsonSchema(z.strictObject({ subject: reviewSchema.shape.subject })),
    output: jsonSchema(z.strictObject({ items: z.array(reviewSchema) })),
    permission: { action: 'read', resourceType: 'review' },
    ui: { binding: 'review.list' },
  }),
  reviewSign: defineCapability({
    id: 'review.sign',
    kind: 'command',
    description:
      'Approve or reject a record at its current revision. Pass the revision you read as expectedRevisions. The record author and agent runs are refused, and each reviewer signs a revision once.',
    input: jsonSchema(
      z.strictObject({
        subject: reviewSchema.shape.subject,
        verdict: reviewSchema.shape.verdict,
        comment: reviewSchema.shape.comment.optional(),
      }),
    ),
    output: jsonSchema(reviewSchema),
    permission: { action: 'sign', resourceType: 'review' },
    ui: { binding: 'review.sign' },
    display: { label: 'Sign review' },
  }),
} as const;

/** The browser-safe part the application lists in `defineManifest({ features })`. */
export const reviewFeatureManifest = defineFeatureManifest({
  id: 'review',
  title: 'Review',
  modules: [defineModule({ id: 'review', capabilities: Object.values(reviewOperations) })],
});
