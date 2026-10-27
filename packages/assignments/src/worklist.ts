import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  definePeerTarget,
  deliveryStatusSchema,
  jsonSchema,
  recordKeySchema,
  rejectionSchema,
  unitIdPattern,
  type AnyCapability,
  type Availability,
  type OfflineBehavior,
  type PeerApi,
} from '@agent-native/contracts';
import type { AnyAssignmentKind } from './kind';
import type { Assignments } from './manifest';
import { camel, type Camel } from './operations';
import { anyFeedItemSchema, kindIdSchema, MAX_OPEN, unionOf, type AnyFeedItemOf } from './schemas';

/** The resource types the worklist's operations name in their permissions. */
export const WORKLIST_ASSIGNMENT = 'WorklistAssignment';
export const WORKLIST_REPORT = 'WorklistReport';
export const WORKLIST_SYNC = 'WorklistSync';

const time = z.number().int();
const sync = { sync: deliveryStatusSchema, rejection: rejectionSchema.optional() };

/** An assignment as the assignee holds it: the issuer's feed item and what was done here. */
const localAssignmentShape = {
  /**
   * Whether it takes reports: the issuer still lists it as sent and it is not done here. The
   * issuer stops listing an assignment it withdrew, closed or marked done itself.
   */
  open: z.boolean(),
  /** Reports recorded here for it. */
  reports: z.number().int().min(0),
  /** Marked done here; no further reports are taken. */
  done: z.boolean(),
  /** How the done mark stands with the issuer, once it was made. */
  doneSync: deliveryStatusSchema.optional(),
  rejection: rejectionSchema.optional(),
};
/** A report as the assignee holds it, with how it stands with the issuer. */
function localReportSchemaOf<K extends AnyAssignmentKind>(kind: K) {
  return z.strictObject({
    id: recordKeySchema,
    assignmentId: recordKeySchema,
    kind: z.literal(kind.id as K['id']),
    subject: recordKeySchema.optional(),
    body: kind.report as K['report'],
    reportedAt: time,
    ...sync,
  });
}
export type LocalReportOf<K extends AnyAssignmentKind> = {
  readonly id: string;
  readonly assignmentId: string;
  readonly kind: K['id'];
  readonly subject?: string;
  readonly body: z.output<K['report']>;
  readonly reportedAt: number;
  readonly sync: z.output<typeof deliveryStatusSchema>;
  readonly rejection?: z.output<typeof rejectionSchema>;
};
type AnyLocalReportOf<K> = K extends AnyAssignmentKind ? LocalReportOf<K> : never;
export type LocalAssignmentOf<K> = AnyFeedItemOf<K> & {
  readonly open: boolean;
  readonly reports: number;
  readonly done: boolean;
  readonly doneSync?: z.output<typeof deliveryStatusSchema>;
  readonly rejection?: z.output<typeof rejectionSchema>;
};

export interface WorklistSpec<
  K extends AnyAssignmentKind,
  Namespace extends string,
  Target extends string,
> {
  /** The operation prefix of the worklist, for example `field`. */
  readonly namespace: Namespace;
  /** The outbox target the issuer is reached through, for example `hub`. */
  readonly target: Target;
  /** The issuer's declaration and the peer API it publishes. */
  readonly assignments: Assignments<K>;
  readonly issuer: PeerApi;
  /** Which assignee type of the issuer this worklist takes work as. */
  readonly assigneeType: 'device' | 'peer';
  /** The destination the target is reached through; see `definePeerTarget`. */
  readonly destination: {
    readonly id: string;
    readonly purpose: string;
    readonly dataClasses: readonly string[];
    readonly availability: Availability;
    readonly offline: OfflineBehavior;
  };
}

type ReportCommand<K extends AnyAssignmentKind, Namespace extends string> = ReturnType<
  typeof reportCommand<K, Namespace>
>;
function reportCommand<K extends AnyAssignmentKind, const Namespace extends string>(
  namespace: Namespace,
  kind: K,
  target: string,
  types: { readonly assignment: string; readonly report: string },
) {
  const one = kind.title.toLowerCase();
  return defineCapability({
    id: `${namespace}.${kind.id}.report` as `${Namespace}.${K['id']}.report`,
    kind: 'command',
    description: `Record a ${one} report on an assignment you hold. ${kind.description} It goes to the issuer as soon as it can be reached; a refusal shows on the report.`,
    input: jsonSchema(
      z.strictObject({
        assignmentId: recordKeySchema,
        ...(kind.subject ? { subject: recordKeySchema.optional() } : {}),
        body: kind.report,
      }) as unknown as z.ZodType<{
        readonly assignmentId: string;
        readonly subject?: string;
        readonly body: z.output<K['report']>;
      }>,
    ),
    output: jsonSchema(localReportSchemaOf(kind) as unknown as z.ZodType<LocalReportOf<K>>),
    permission: { action: 'report', resourceType: WORKLIST_REPORT },
    dependencies: [types.report, types.assignment],
    ui: { binding: `${namespace}.${kind.id}.report` },
    display: { label: `Report ${one}` },
    integration: { target, delivery: 'outbox' },
    ...(kind.blobs?.report ? { blobs: kind.blobs.report } : {}),
  });
}

type FlatReports<K extends AnyAssignmentKind, Namespace extends string> = {
  readonly [P in K as `${Camel<P['id']>}Report`]: ReportCommand<P, Namespace>;
};

/**
 * Declare the assignee's side of a device or peer assignment: the worklist an application keeps of the work an
 * issuer sent it, and the reports it records for that work. The result holds the worklist's
 * `module`, its `operations` (`assignmentList`, `assignmentGet`, `reportList`, `complete`, one
 * `<kind>Report` per kind the assignee type takes, and the target's `status`, `sync` and `complete`), the
 * peer `target` whose feed is the issuer's `assignment.feed`, and the resource types it changes.
 *
 * Browser-safe. The server pairs it with `worklistHandlers`, `worklistRules` and
 * `connectWorklist` from `@agent-native/assignments/server`.
 */
export function defineWorklist<
  const K extends AnyAssignmentKind,
  const Namespace extends string,
  const Target extends string,
>(spec: WorklistSpec<K, Namespace, Target>) {
  const { namespace, target, assignments, issuer, assigneeType } = spec;
  if (!unitIdPattern.test(namespace)) throw new Error(`Invalid worklist namespace "${namespace}"`);
  const kinds = assignments.kinds.filter((kind) => kind.assigneeTypes.includes(assigneeType));
  if (kinds.length === 0)
    throw new Error(`No assignment kind takes the ${assigneeType} assignee type`);
  const offered = new Set(issuer.serviceOperations);
  for (const id of assignments.assignees[assigneeType].operations)
    if (!offered.has(id))
      throw new Error(`The peer API of ${issuer.application} does not list ${id}`);
  const types = { assignment: `${namespace}-assignment`, report: `${namespace}-report` } as const;
  const feedItem = anyFeedItemSchema(kinds) as unknown as z.ZodType<AnyFeedItemOf<K>>;
  const peer = definePeerTarget({
    target,
    resourceType: WORKLIST_SYNC,
    api: issuer,
    operations: {
      complete: `${namespace}.${target}.complete`,
      sync: `${namespace}.${target}.sync`,
      status: `${namespace}.${target}.status`,
    },
    changes: [types.assignment, types.report],
    feed: {
      query: assignments.operations.feed,
      item: feedItem,
      max: MAX_OPEN,
      changes: [types.assignment],
    },
    status: {
      pending: z.number().int(),
      accepted: z.number().int(),
      rejected: z.number().int(),
    },
    descriptions: {
      complete: `Integration principal only: record whether ${issuer.application} took a report or a done mark.`,
      sync: `Integration principal only: apply the assignments ${issuer.application} sent here.`,
      status: `Reports and done marks waiting for ${issuer.application}, taken and refused, and when assignments were last received.`,
    },
    destination: spec.destination,
  });
  const localAssignment = anyFeedItemSchema(kinds, localAssignmentShape) as unknown as z.ZodType<
    LocalAssignmentOf<K>
  >;
  const localReport = z.strictObject({
    id: recordKeySchema,
    assignmentId: recordKeySchema,
    kind: kindIdSchema(kinds),
    subject: recordKeySchema.optional(),
    body: unionOf(kinds.map((kind) => kind.report)),
    reportedAt: time,
    ...sync,
  }) as unknown as z.ZodType<AnyLocalReportOf<K>>;
  const reports = Object.fromEntries(
    kinds.map((kind) => [`${camel(kind.id)}Report`, reportCommand(namespace, kind, target, types)]),
  ) as FlatReports<K, Namespace>;
  const id = jsonSchema(z.strictObject({ id: recordKeySchema }));
  const operations = Object.freeze({
    assignmentList: defineCapability({
      id: `${namespace}.assignment.list` as `${Namespace}.assignment.list`,
      kind: 'query',
      description: `The assignments ${issuer.application} sent here, newest first, with how many reports each has here.`,
      input: jsonSchema(z.strictObject({})),
      output: jsonSchema(z.strictObject({ items: z.array(localAssignment) })),
      permission: { action: 'read', resourceType: WORKLIST_ASSIGNMENT },
      dependencies: [types.assignment, types.report],
      ui: { binding: `${namespace}.assignment.list` },
      display: { label: 'Assignments', titleField: 'title' },
    }),
    assignmentGet: defineCapability({
      id: `${namespace}.assignment.get` as `${Namespace}.assignment.get`,
      kind: 'query',
      description: 'One assignment held here, with its brief, or NOT_FOUND.',
      input: id,
      output: jsonSchema(localAssignment),
      permission: { action: 'read', resourceType: WORKLIST_ASSIGNMENT },
      dependencies: [types.assignment, types.report],
      ui: { binding: `${namespace}.assignment.get` },
      display: { label: 'Assignment', titleField: 'title' },
    }),
    reportList: defineCapability({
      id: `${namespace}.report.list` as `${Namespace}.report.list`,
      kind: 'query',
      description: `Reports recorded here, newest first, with whether ${issuer.application} took each.`,
      input: jsonSchema(z.strictObject({ assignmentId: recordKeySchema.optional() })),
      output: jsonSchema(z.strictObject({ items: z.array(localReport) })),
      permission: { action: 'read', resourceType: WORKLIST_REPORT },
      dependencies: [types.report],
      ui: { binding: `${namespace}.report.list` },
      display: { label: 'Reports' },
    }),
    complete: defineCapability({
      id: `${namespace}.assignment.complete` as `${Namespace}.assignment.complete`,
      kind: 'command',
      description: `Mark an assignment done here: no further reports are taken for it, and ${issuer.application} is told after the reports already waiting.`,
      input: id,
      output: jsonSchema(localAssignment),
      permission: { action: 'complete', resourceType: WORKLIST_ASSIGNMENT },
      dependencies: [types.assignment],
      ui: { binding: `${namespace}.assignment.complete` },
      display: { label: 'Done' },
      integration: { target, delivery: 'outbox' },
    }),
    ...reports,
    status: peer.status,
    sync: peer.sync,
    effectComplete: peer.complete,
  });
  return Object.freeze({
    namespace,
    assigneeType,
    kinds,
    types,
    target: peer,
    operations,
    module: defineModule({
      id: `${namespace}-worklist`,
      capabilities: Object.values(operations) as AnyCapability[],
    }),
  });
}
export type Worklist<K extends AnyAssignmentKind = AnyAssignmentKind> = ReturnType<
  typeof defineWorklist<K, string, string>
>;
