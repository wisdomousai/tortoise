import { z } from 'zod';
import { assertBlobLimits, unitIdPattern, type BlobLimits } from '@tortoise/contracts';

/** Who may take an assignment, and how it reaches them. */
export const assigneeTypes = ['person', 'agent', 'device', 'peer', 'target'] as const;
export type AssigneeType = (typeof assigneeTypes)[number];

/**
 * Words the generic operations use in the second part of their IDs, such as `assignment.list`
 * and `assignment.report.link`; no kind or assignment target may take one.
 */
export const reservedAssignmentNames: readonly string[] = [
  'report',
  'withdraw',
  'complete',
  'close',
  'list',
  'get',
  'inbound',
];

/** The longest kind or assignment target name: `assignment_<name>_create` stays within 64 characters. */
export const MAX_ASSIGNMENT_NAME = 40;

type Shape = z.ZodObject;

export interface AssignmentKindSpec<
  Id extends string,
  Scope extends Shape,
  Instructions extends Shape,
  Report extends Shape,
  Accept extends Shape,
> {
  /** Lowercase and hyphen-separated: the second part of the kind's operation IDs. */
  readonly id: Id;
  /** What the work is called, for example `Survey`. */
  readonly title: string;
  /** What the assignee is asked to do. Agents read it in the report command's description. */
  readonly description: string;
  /** What the requester fills in when creating an assignment of this kind. */
  readonly scope: Scope;
  /** What the assignee receives. The server's `instructions` hook computes it from the scope on send. */
  readonly instructions: Instructions;
  /** The body of one report. */
  readonly report: Report;
  /** The reviewer's input when accepting a report, besides the report's ID. Empty when omitted. */
  readonly accept?: Accept;
  /** The record type a report is about, for example `node`. A report names one by its key. */
  readonly subject?: string;
  /**
   * Limits on the blobs a report body references, and on those the instructions reference. Instructions blobs
   * reach only assignees on the same instance or a target, because a peer pull carries no blobs.
   */
  readonly blobs?: { readonly report?: BlobLimits; readonly instructions?: BlobLimits };
  /** Who may take this kind of work. */
  readonly assigneeTypes: readonly AssigneeType[];
  /** The assignment target's name, required exactly when `assigneeTypes` includes `target`. */
  readonly target?: string;
  /** Operations the accept hook calls through `ctx.invoke` or `ctx.query`. */
  readonly invokes?: readonly string[];
  /** Records the accept hook changes, so the screens that read them refresh. */
  readonly changes?: readonly string[];
}

export interface AssignmentKind<
  Id extends string = string,
  Scope extends Shape = Shape,
  Instructions extends Shape = Shape,
  Report extends Shape = Shape,
  Accept extends Shape = Shape,
> extends AssignmentKindSpec<Id, Scope, Instructions, Report, Accept> {
  readonly accept: Accept;
}
export type AnyAssignmentKind = AssignmentKind<string, Shape, Shape, Shape, Shape>;

/** Throw unless `name` can be a kind or assignment target name. */
export function checkAssignmentName(name: string, what: string): void {
  if (!unitIdPattern.test(name) || name.length > MAX_ASSIGNMENT_NAME)
    throw new Error(`Invalid assignment ${what} "${name}"`);
  if (reservedAssignmentNames.includes(name))
    throw new Error(`Assignment ${what} "${name}" is reserved for a generic operation`);
}

/**
 * Declare a kind of work: what the requester fills in, what the assignee receives, what one
 * report holds, what the reviewer adds on accepting, and who may take it. Browser-safe. Fails
 * at definition time on an invalid or reserved ID, an unknown or repeated assignee type, the
 * `target` type without a target name or a target name without the type, instructions blobs for a
 * device or a peer, and an accept input with its own `id`.
 */
export function defineAssignmentKind<
  const Id extends string,
  Scope extends Shape,
  Instructions extends Shape,
  Report extends Shape,
  Accept extends Shape = z.ZodObject<{}>,
>(
  spec: AssignmentKindSpec<Id, Scope, Instructions, Report, Accept>,
): AssignmentKind<Id, Scope, Instructions, Report, Accept> {
  const fail = (message: string): never => {
    throw new Error(`Assignment kind ${spec.id} ${message}`);
  };
  checkAssignmentName(spec.id, 'kind');
  if (spec.assigneeTypes.length === 0) fail('has no assignee type');
  for (const type of spec.assigneeTypes)
    if (!assigneeTypes.includes(type)) fail(`has an unknown assignee type "${type}"`);
  if (new Set(spec.assigneeTypes).size !== spec.assigneeTypes.length)
    fail('repeats an assignee type');
  const targeted = spec.assigneeTypes.includes('target');
  if (targeted !== (spec.target !== undefined))
    fail(
      targeted
        ? 'has the target assignee type without a target'
        : 'names a target without the target assignee type',
    );
  if (spec.target !== undefined) checkAssignmentName(spec.target, 'target');
  if (spec.blobs?.report) assertBlobLimits(spec.blobs.report, `${spec.id} reports`);
  if (spec.blobs?.instructions) {
    assertBlobLimits(spec.blobs.instructions, `${spec.id} instructions`);
    if (spec.assigneeTypes.includes('device') || spec.assigneeTypes.includes('peer'))
      fail('cannot send instructions blobs to a device or a peer, whose pull carries no blobs');
  }
  if (spec.accept && 'id' in spec.accept.shape) fail('has an accept input with its own id');
  if (spec.subject !== undefined && !/^[a-z][a-z0-9-]*$/.test(spec.subject))
    fail(`has an invalid subject type "${spec.subject}"`);
  return Object.freeze({
    ...spec,
    accept: (spec.accept ?? z.strictObject({})) as Accept,
    assigneeTypes: Object.freeze([...spec.assigneeTypes]),
  });
}
