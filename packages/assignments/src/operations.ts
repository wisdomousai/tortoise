import { z } from 'zod';
import {
  defineCapability,
  jsonSchema,
  MAX_PAGE,
  recordKeySchema,
  type Capability,
} from '@tortoise/contracts';
import type { AnyAssignmentKind } from './kind';
import {
  anyAssignmentSchema,
  anyInboundItemSchema,
  anyReportSchema,
  assigneeSchema,
  assignmentNoteSchema,
  assignmentSchemaOf,
  assignmentStageSchema,
  assignmentTitleSchema,
  kindIdSchema,
  reportSchemaOf,
  reviewStateSchema,
  type AnyInboundItemOf,
  type AnyReportOf,
  type Assignee,
  type AssignmentOf,
  type AssignmentReportOf,
  type AssignmentStage,
  type ReviewState,
} from './schemas';

/** The resource types the generated operations name in their permissions. */
export const ASSIGNMENT = 'Assignment';
export const ASSIGNMENT_REPORT = 'AssignmentReport';

/** The outbox target of an assignment target named `name`: `assignment-<name>`. */
export const targetOf = (name: string) => `assignment-${name}`;

/** `field-work` as `fieldWork`, the key prefix of a kind's operations. */
export type Camel<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<Camel<Tail>>}`
  : S;
export const camel = <S extends string>(name: S) =>
  name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase()) as Camel<S>;

const permission = (resourceType: string, action: string) => ({ action, resourceType });
const display = (label: string, resource: string) => ({ label, resource, titleField: 'title' });
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE).optional(),
};

/** The input of a kind's create command. */
export type CreateInput<K extends AnyAssignmentKind> = {
  readonly title: string;
  readonly note?: string;
  readonly scope: z.output<K['scope']>;
  readonly assignee?: Assignee;
};
/** The input of a kind's report command. */
export type ReportInput<K extends AnyAssignmentKind> = {
  readonly id: string;
  readonly assignmentId: string;
  readonly subject?: string;
  readonly body: z.output<K['report']>;
};

/** The four commands of one kind: create, send, report and accept. */
export function kindOperations<const K extends AnyAssignmentKind>(kind: K) {
  const base = `assignment.${kind.id}` as const;
  const assignment = assignmentSchemaOf(kind) as unknown as z.ZodType<AssignmentOf<K>>;
  const report = reportSchemaOf(kind) as unknown as z.ZodType<AssignmentReportOf<K>>;
  const forwards = kind.target
    ? { integration: { target: targetOf(kind.target), delivery: 'outbox' as const } }
    : {};
  const instructionsBlobs = kind.blobs?.instructions ? { blobs: kind.blobs.instructions } : {};
  const one = kind.title.toLowerCase();
  return {
    create: defineCapability({
      id: `${base}.create` as `assignment.${K['id']}.create`,
      kind: 'command',
      description: `Create a ${one} assignment. ${kind.description} With an assignee it is sent at once; without one it stays a draft until sent.`,
      input: jsonSchema(
        z.strictObject({
          title: assignmentTitleSchema,
          note: assignmentNoteSchema.optional(),
          scope: kind.scope,
          assignee: assigneeSchema.optional(),
        }) as unknown as z.ZodType<CreateInput<K>>,
      ),
      output: jsonSchema(assignment),
      permission: permission(ASSIGNMENT, 'plan'),
      dependencies: ['assignment'],
      ui: { binding: `${base}.create` },
      display: display(`New ${one}`, 'assignment'),
      ...forwards,
      ...instructionsBlobs,
    }),
    send: defineCapability({
      id: `${base}.send` as `assignment.${K['id']}.send`,
      kind: 'command',
      description: `Send a draft ${one} assignment to an assignee, with the instructions computed from its scope now. An assignee who may not take ${one} work is refused.`,
      input: jsonSchema(z.strictObject({ id: recordKeySchema, assignee: assigneeSchema })),
      output: jsonSchema(assignment),
      permission: permission(ASSIGNMENT, 'plan'),
      dependencies: ['assignment'],
      ui: { binding: `${base}.send` },
      display: display('Send', 'assignment'),
      ...forwards,
      ...instructionsBlobs,
    }),
    report: defineCapability({
      id: `${base}.report` as `assignment.${K['id']}.report`,
      kind: 'command',
      description: `Report on a ${one} assignment you were given. ${kind.description} One report per call, under an ID you choose: the same report again is harmless, and a different one under the same ID conflicts. Refused once the assignment is withdrawn or closed; a report after your done mark is still taken.${
        kind.subject
          ? ` Name the ${kind.subject} the report is about as subject; one the assignment does not cover is refused, or from a device or a peer application kept unlinked for a person to link.`
          : ''
      }`,
      input: jsonSchema(
        z.strictObject({
          id: recordKeySchema,
          assignmentId: recordKeySchema,
          ...(kind.subject ? { subject: recordKeySchema.optional() } : {}),
          body: kind.report,
        }) as unknown as z.ZodType<ReportInput<K>>,
      ),
      output: jsonSchema(report),
      permission: permission(ASSIGNMENT_REPORT, 'work'),
      dependencies: ['assignment', 'assignment-report'],
      ui: { binding: `${base}.report` },
      display: { label: `Report ${one}`, resource: 'assignment-report' },
      ...(kind.blobs?.report ? { blobs: kind.blobs.report } : {}),
    }),
    accept: defineCapability({
      id: `${base}.accept` as `assignment.${K['id']}.accept`,
      kind: 'command',
      description: `Accept a ${one} report into the application's records${
        Object.keys(kind.accept.shape).length ? ', with the values you checked' : ''
      }. People only; an agent run is refused. Refused for a report already reviewed.`,
      input: jsonSchema(
        z.strictObject({ id: recordKeySchema, ...kind.accept.shape }) as unknown as z.ZodType<
          { readonly id: string } & z.output<K['accept']>
        >,
      ),
      output: jsonSchema(report),
      permission: permission(ASSIGNMENT_REPORT, 'review'),
      dependencies: [...new Set(['assignment-report', 'assignment', ...(kind.changes ?? [])])],
      ui: { binding: `${base}.accept` },
      display: { label: 'Accept', resource: 'assignment-report' },
      ...(kind.invokes ? { invokes: kind.invokes } : {}),
    }),
  };
}

/** The input of the assignment list. */
export type AssignmentListInput = {
  readonly kind?: string;
  readonly stage?: AssignmentStage;
  readonly assigneeType?: Assignee['type'];
  readonly assigneeId?: string;
  readonly offset?: number;
  readonly limit?: number;
};
/** The input of the report list. */
export type ReportListInput = {
  readonly assignmentId?: string;
  readonly kind?: string;
  readonly review?: ReviewState;
  readonly subject?: string;
  readonly offset?: number;
  readonly limit?: number;
};

/** The operations shared by every kind: lifecycle, reads, inbound sync and review. */
export function genericOperations<const K extends AnyAssignmentKind>(kinds: readonly K[]) {
  const assignment = anyAssignmentSchema(kinds);
  const report = anyReportSchema(kinds);
  const inboundItem = anyInboundItemSchema(kinds) as unknown as z.ZodType<AnyInboundItemOf<K>>;
  const kindId = kindIdSchema(kinds);
  const id = z.strictObject({ id: recordKeySchema });
  const idInput = jsonSchema(id);
  const subjects = kinds.some((kind) => kind.subject !== undefined);
  const command = <const Id extends string, I, O>(
    id: Id,
    spec: {
      description: string;
      input: z.ZodType<I>;
      output: z.ZodType<O>;
      resourceType: string;
      action: string;
      label: string;
      resource: string;
    },
  ) =>
    defineCapability({
      id,
      kind: 'command',
      description: spec.description,
      input: jsonSchema(spec.input),
      output: jsonSchema(spec.output),
      permission: permission(spec.resourceType, spec.action),
      dependencies: ['assignment', 'assignment-report'],
      ui: { binding: id },
      display: { label: spec.label, resource: spec.resource },
    });
  const withdrawInput = z.strictObject({
    id: recordKeySchema,
    reason: z.string().min(1).max(2000).optional(),
  });
  return {
    withdraw: command('assignment.withdraw', {
      description:
        'Withdraw an assignment that is not done: the assignee no longer sees it, and a report sent after this is refused. A target that already took the offer may still return a result; the result is ignored.',
      input: withdrawInput,
      output: assignment,
      resourceType: ASSIGNMENT,
      action: 'plan',
      label: 'Withdraw',
      resource: 'assignment',
    }),
    complete: command('assignment.complete', {
      description:
        'Mark a sent assignment done: no further reports are taken. The assignee does this when the work is finished; a planner may do it for an assignee that cannot, such as a lost device.',
      input: id,
      output: assignment,
      resourceType: ASSIGNMENT,
      action: 'work',
      label: 'Done',
      resource: 'assignment',
    }),
    close: command('assignment.close', {
      description:
        'Close a done assignment after review. Reports not yet reviewed stay as they are and can still be accepted or discarded.',
      input: id,
      output: assignment,
      resourceType: ASSIGNMENT,
      action: 'review',
      label: 'Close',
      resource: 'assignment',
    }),
    list: defineCapability({
      id: 'assignment.list',
      kind: 'query',
      description:
        'Assignments you may see, newest first, filtered by kind, stage or assignee, with how many reports each has and how many are not yet reviewed.',
      input: jsonSchema(
        z.strictObject({
          kind: kindId.optional(),
          stage: assignmentStageSchema.optional(),
          assigneeType: assigneeSchema.shape.type.optional(),
          assigneeId: assigneeSchema.shape.id.optional(),
          ...page,
        }) as unknown as z.ZodType<AssignmentListInput>,
      ),
      output: jsonSchema(
        z.strictObject({ items: z.array(assignment), total: z.number().int().min(0) }),
      ),
      permission: permission(ASSIGNMENT, 'read'),
      dependencies: ['assignment', 'assignment-report'],
      ui: { binding: 'assignment.list' },
      display: display('Assignments', 'assignment'),
    }),
    get: defineCapability({
      id: 'assignment.get',
      kind: 'query',
      description: 'One assignment you may see, with its scope and instructions, or NOT_FOUND.',
      input: idInput,
      output: jsonSchema(assignment),
      permission: permission(ASSIGNMENT, 'read'),
      dependencies: ['assignment', 'assignment-report'],
      ui: { binding: 'assignment.get' },
      display: display('Assignment', 'assignment'),
    }),
    inbound: defineCapability({
      id: 'assignment.inbound',
      kind: 'query',
      description:
        'The assignments sent to you that are not done, with their instructions: all of them at once. Pass the cursor of your last read; an unchanged set returns no items and the same cursor.',
      input: jsonSchema(z.strictObject({ cursor: z.string().max(256).optional() })),
      output: jsonSchema(
        z.strictObject({
          items: z.array(inboundItem),
          cursor: z.string(),
          more: z.boolean().optional(),
        }),
      ),
      permission: permission(ASSIGNMENT, 'work'),
      dependencies: ['assignment'],
      ui: { binding: 'assignment.inbound' },
      display: display('My assignments', 'assignment'),
    }),
    reportList: defineCapability({
      id: 'assignment.report.list',
      kind: 'query',
      description:
        'Reports you may see, newest first, filtered by assignment, kind, review state or subject.',
      input: jsonSchema(
        z.strictObject({
          assignmentId: recordKeySchema.optional(),
          kind: kindId.optional(),
          review: reviewStateSchema.optional(),
          ...(subjects ? { subject: recordKeySchema.optional() } : {}),
          ...page,
        }) as unknown as z.ZodType<ReportListInput>,
      ),
      output: jsonSchema(
        z.strictObject({ items: z.array(report), total: z.number().int().min(0) }),
      ),
      permission: permission(ASSIGNMENT_REPORT, 'read'),
      dependencies: ['assignment-report'],
      ui: { binding: 'assignment.report.list' },
      display: { label: 'Reports', resource: 'assignment-report' },
    }),
    reportGet: defineCapability({
      id: 'assignment.report.get',
      kind: 'query',
      description: 'One report you may see, or NOT_FOUND.',
      input: idInput,
      output: jsonSchema(report),
      permission: permission(ASSIGNMENT_REPORT, 'read'),
      dependencies: ['assignment-report'],
      ui: { binding: 'assignment.report.get' },
      display: { label: 'Report', resource: 'assignment-report' },
    }),
    reportDiscard: command('assignment.report.discard', {
      description:
        'Discard a report that is not yet reviewed, optionally saying why. Nothing of it reaches the application records.',
      input: withdrawInput,
      output: report,
      resourceType: ASSIGNMENT_REPORT,
      action: 'review',
      label: 'Discard',
      resource: 'assignment-report',
    }),
    ...((subjects
      ? {
          reportLink: command('assignment.report.link', {
            description:
              'Say which record a report not yet reviewed is about, for one that named none or the wrong one. The record must be one the assignment covers.',
            input: z.strictObject({ id: recordKeySchema, subject: recordKeySchema }),
            output: report,
            resourceType: ASSIGNMENT_REPORT,
            action: 'review',
            label: 'Link',
            resource: 'assignment-report',
          }),
        }
      : {}) as { readonly reportLink?: LinkCapability<K> }),
  };
}
type LinkCapability<K extends AnyAssignmentKind> = Capability<
  'assignment.report.link',
  'command',
  { readonly id: string; readonly subject: string },
  AnyReportOf<K>
>;
