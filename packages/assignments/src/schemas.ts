import { z } from 'zod';
import {
  deliveryStatusSchema,
  jsonValueSchema,
  recordKeySchema,
  rejectionSchema,
  type JsonValue,
} from '@tortoise/contracts';
import { assigneeTypes, type AnyAssignmentKind } from './kind';

/** What the requester decided: still a draft, sent, done by the assignee, withdrawn or closed. */
export const assignmentStatusSchema = z.enum(['draft', 'sent', 'done', 'withdrawn', 'closed']);
export type AssignmentStatus = z.output<typeof assignmentStatusSchema>;

/**
 * Where an assignment stands, from its status and its reports: `working` is sent with at least
 * one report, and `reviewed` is done with every report accepted or discarded.
 */
export const assignmentStageSchema = z.enum([
  'draft',
  'sent',
  'working',
  'done',
  'reviewed',
  'withdrawn',
  'closed',
]);
export type AssignmentStage = z.output<typeof assignmentStageSchema>;

/**
 * Who takes an assignment. `id` is a principal ID for a person, an agent definition's ID, a
 * device ID (principal `device:<id>`), a peer application's ID (principal `peer:<id>`) or a
 * assignment target's name.
 */
export const assigneeSchema = z.strictObject({
  type: z.enum(assigneeTypes),
  id: z.string().min(1).max(128),
});
export type Assignee = z.output<typeof assigneeSchema>;

/** A report's review: not yet reviewed, accepted into the application's records, or discarded. */
export const reviewStateSchema = z.enum(['new', 'accepted', 'discarded']);
export type ReviewState = z.output<typeof reviewStateSchema>;

/** The most assignments one assignee may hold open; the feed carries all of them at once. */
export const MAX_OPEN = 100;
/** The most reports a target returns for one offer. */
export const MAX_TARGET_REPORTS = 50;

const principal = z.string().min(1).max(256);
const time = z.number().int();
export const assignmentTitleSchema = z.string().min(1).max(200);
export const assignmentNoteSchema = z.string().max(2000);
const reason = z.string().min(1).max(2000);

/** Fields of every assignment, whatever its kind, as callers see them. */
export const assignmentShape = {
  id: recordKeySchema,
  title: assignmentTitleSchema,
  /** Instructions for the assignee, beyond what the brief holds. */
  note: assignmentNoteSchema.optional(),
  assignee: assigneeSchema.optional(),
  status: assignmentStatusSchema,
  stage: assignmentStageSchema,
  /** Reports received, and how many of them are not yet reviewed. */
  reports: z.number().int().min(0),
  unreviewed: z.number().int().min(0),
  createdBy: principal,
  createdAt: time,
  sentAt: time.optional(),
  doneBy: principal.optional(),
  doneAt: time.optional(),
  closedBy: principal.optional(),
  closedAt: time.optional(),
  /** Why it was withdrawn. */
  reason: reason.optional(),
  /** Assignment target only: whether the target took the offer, and why it refused. */
  delivery: deliveryStatusSchema.optional(),
  rejection: rejectionSchema.optional(),
};

/** Fields of every report, whatever its kind. */
export const reportShape = {
  /** Chosen by the reporter, so a repeated delivery of the same report is recognized. */
  id: recordKeySchema,
  assignmentId: recordKeySchema,
  /** The key of the record the report is about, of the kind's subject type. */
  subject: recordKeySchema.optional(),
  reportedBy: principal,
  /** The agent run that reported it. */
  runId: z.string().min(1).max(128).optional(),
  reportedAt: time,
  review: reviewStateSchema,
  reviewedBy: principal.optional(),
  reviewedAt: time.optional(),
  /** Why it was discarded. */
  reason: reason.optional(),
};

/** One assignment of `kind`, with its scope and, once sent, its brief. */
export function assignmentSchemaOf<K extends AnyAssignmentKind>(kind: K) {
  return z.strictObject({
    ...assignmentShape,
    kind: z.literal(kind.id as K['id']),
    scope: kind.scope as K['scope'],
    brief: (kind.brief as K['brief']).optional(),
  });
}
/** One report on an assignment of `kind`, with what the reviewer gave on accepting it. */
export function reportSchemaOf<K extends AnyAssignmentKind>(kind: K) {
  return z.strictObject({
    ...reportShape,
    kind: z.literal(kind.id as K['id']),
    body: kind.report as K['report'],
    accepted: (kind.accept as K['accept']).optional(),
  });
}
/** The payload of the outbox effect that offers an assignment of `kind` to its target. */
export function offerSchemaOf<K extends AnyAssignmentKind>(kind: K) {
  return z.strictObject({
    assignmentId: recordKeySchema,
    kind: z.literal(kind.id as K['id']),
    title: assignmentTitleSchema,
    note: assignmentNoteSchema.optional(),
    brief: kind.brief as K['brief'],
  });
}

/** One schema per kind, or their union. */
export function unionOf<S extends z.ZodType>(schemas: readonly S[]): z.ZodType<z.output<S>> {
  if (schemas.length === 0) throw new Error('Assignments need at least one kind');
  return (schemas.length === 1 ? schemas[0]! : z.union(schemas as [S, S, ...S[]])) as z.ZodType<
    z.output<S>
  >;
}

/** The kinds' IDs as an enum. */
export const kindIdSchema = <K extends AnyAssignmentKind>(kinds: readonly K[]) =>
  z.enum(kinds.map((kind) => kind.id) as [K['id'], ...K['id'][]]);

/**
 * An assignment of any of `kinds`: one object whose `kind` is any of theirs and whose scope and
 * brief are any of theirs, so a generic read keeps one record shape for display.
 */
export function anyAssignmentSchema<K extends AnyAssignmentKind>(kinds: readonly K[]) {
  return z.strictObject({
    ...assignmentShape,
    kind: kindIdSchema(kinds),
    scope: unionOf(kinds.map((kind) => kind.scope)),
    brief: unionOf(kinds.map((kind) => kind.brief)).optional(),
  }) as unknown as z.ZodType<AnyAssignmentOf<K>>;
}
/** A report on an assignment of any of `kinds`. */
export function anyReportSchema<K extends AnyAssignmentKind>(kinds: readonly K[]) {
  return z.strictObject({
    ...reportShape,
    kind: kindIdSchema(kinds),
    body: unionOf(kinds.map((kind) => kind.report)),
    accepted: unionOf(kinds.map((kind) => kind.accept)).optional(),
  }) as unknown as z.ZodType<AnyReportOf<K>>;
}
/** A feed item of any of `kinds`, with `extra` fields. */
export function anyFeedItemSchema<K extends AnyAssignmentKind, Extra extends z.ZodRawShape = {}>(
  kinds: readonly K[],
  extra?: Extra,
) {
  return z.strictObject({
    id: recordKeySchema,
    kind: kindIdSchema(kinds),
    title: assignmentTitleSchema,
    note: assignmentNoteSchema.optional(),
    brief: unionOf(kinds.map((kind) => kind.brief)),
    sentAt: time,
    ...extra,
  });
}

/**
 * What a target returns for one offer, as an item of its feed: the reports, each under an ID
 * the target chose. Applying it marks the assignment done. Each body is checked against the
 * assignment's kind when the result is applied, so one malformed report does not hold back the others.
 */
export const targetResultSchema = z.strictObject({
  assignmentId: recordKeySchema,
  /** The offer this is for; a result for an older offer is ignored. */
  effectId: z.string().min(1).max(128),
  reports: z
    .array(
      z.strictObject({
        id: recordKeySchema,
        subject: recordKeySchema.optional(),
        body: z.record(z.string(), jsonValueSchema),
      }),
    )
    .max(MAX_TARGET_REPORTS),
});

type Common<Shape extends z.ZodRawShape> = z.output<z.ZodObject<Shape>>;
/** An assignment of kind `K`. */
export type AssignmentOf<K extends AnyAssignmentKind> = Common<typeof assignmentShape> & {
  readonly kind: K['id'];
  readonly scope: z.output<K['scope']>;
  readonly brief?: z.output<K['brief']>;
};
/** A report on an assignment of kind `K`. */
export type AssignmentReportOf<K extends AnyAssignmentKind> = Common<typeof reportShape> & {
  readonly kind: K['id'];
  readonly body: z.output<K['report']>;
  readonly accepted?: z.output<K['accept']>;
};
/** What an assignee's feed carries for an assignment of kind `K`. */
export type FeedItemOf<K extends AnyAssignmentKind> = {
  readonly id: string;
  readonly kind: K['id'];
  readonly title: string;
  readonly note?: string;
  readonly brief: z.output<K['brief']>;
  readonly sentAt: number;
};
/** The offer a target receives for an assignment of kind `K`. */
export type OfferOf<K extends AnyAssignmentKind> = {
  readonly assignmentId: string;
  readonly kind: K['id'];
  readonly title: string;
  readonly note?: string;
  readonly brief: z.output<K['brief']>;
};
/** Any of the kinds' assignments, reports, feed items or offers. */
export type AnyAssignmentOf<K> = K extends AnyAssignmentKind ? AssignmentOf<K> : never;
export type AnyReportOf<K> = K extends AnyAssignmentKind ? AssignmentReportOf<K> : never;
export type AnyFeedItemOf<K> = K extends AnyAssignmentKind ? FeedItemOf<K> : never;
export type AnyOfferOf<K> = K extends AnyAssignmentKind ? OfferOf<K> : never;

/** A report's body or a brief as stored, before its kind's schema is applied. */
export type StoredBody = Readonly<Record<string, JsonValue>>;
