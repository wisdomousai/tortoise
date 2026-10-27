import { z } from 'zod';
import { assertBlobLimits, unitIdPattern, type BlobLimits } from '@agent-native/contracts';

/** Who may take an assignment, and how it reaches them. */
export const assignmentLanes = ['person', 'agent', 'device', 'peer', 'target'] as const;
export type AssignmentLane = (typeof assignmentLanes)[number];

/**
 * Words the generic operations use in the second part of their IDs, such as `assignment.list`
 * and `assignment.report.place`; no kind or target lane may take one.
 */
export const reservedAssignmentNames: readonly string[] = [
  'report',
  'withdraw',
  'complete',
  'close',
  'list',
  'get',
  'feed',
];

/** The longest kind or target lane name: `assignment_<name>_create` stays within 64 characters. */
export const MAX_ASSIGNMENT_NAME = 40;

type Shape = z.ZodObject;

export interface AssignmentKindSpec<
  Id extends string,
  Scope extends Shape,
  Brief extends Shape,
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
  /** What the assignee receives. The server's `brief` hook computes it from the scope on send. */
  readonly brief: Brief;
  /** The body of one report. */
  readonly report: Report;
  /** The reviewer's input when accepting a report, besides the report's ID. Empty when omitted. */
  readonly accept?: Accept;
  /** The record type a report is about, for example `node`. A report names one by its key. */
  readonly subject?: string;
  /**
   * Limits on the blobs a report body references, and on those a brief references. Brief blobs
   * reach only assignees on the same instance or a target, because a peer pull carries no blobs.
   */
  readonly blobs?: { readonly report?: BlobLimits; readonly brief?: BlobLimits };
  /** Who may take this kind of work. */
  readonly lanes: readonly AssignmentLane[];
  /** The target lane's name, required exactly when `lanes` includes `target`. */
  readonly target?: string;
  /** Operations the accept hook calls through `ctx.invoke` or `ctx.query`. */
  readonly invokes?: readonly string[];
  /** Records the accept hook changes, so the screens that read them refresh. */
  readonly changes?: readonly string[];
}

export interface AssignmentKind<
  Id extends string = string,
  Scope extends Shape = Shape,
  Brief extends Shape = Shape,
  Report extends Shape = Shape,
  Accept extends Shape = Shape,
> extends AssignmentKindSpec<Id, Scope, Brief, Report, Accept> {
  readonly accept: Accept;
}
export type AnyAssignmentKind = AssignmentKind<string, Shape, Shape, Shape, Shape>;

/** Throw unless `name` can be a kind or target lane name. */
export function checkAssignmentName(name: string, what: string): void {
  if (!unitIdPattern.test(name) || name.length > MAX_ASSIGNMENT_NAME)
    throw new Error(`Invalid assignment ${what} "${name}"`);
  if (reservedAssignmentNames.includes(name))
    throw new Error(`Assignment ${what} "${name}" is reserved for a generic operation`);
}

/**
 * Declare a kind of work: what the requester fills in, what the assignee receives, what one
 * report holds, what the reviewer adds on accepting, and who may take it. Browser-safe. Fails
 * at definition time on an invalid or reserved ID, an unknown or repeated lane, a target lane
 * without its target or a target without the lane, brief blobs for a device or peer lane, and
 * an accept input with its own `id`.
 */
export function defineAssignmentKind<
  const Id extends string,
  Scope extends Shape,
  Brief extends Shape,
  Report extends Shape,
  Accept extends Shape = z.ZodObject<{}>,
>(
  spec: AssignmentKindSpec<Id, Scope, Brief, Report, Accept>,
): AssignmentKind<Id, Scope, Brief, Report, Accept> {
  const fail = (message: string): never => {
    throw new Error(`Assignment kind ${spec.id} ${message}`);
  };
  checkAssignmentName(spec.id, 'kind');
  if (spec.lanes.length === 0) fail('has no lane');
  for (const lane of spec.lanes)
    if (!assignmentLanes.includes(lane)) fail(`has an unknown lane "${lane}"`);
  if (new Set(spec.lanes).size !== spec.lanes.length) fail('repeats a lane');
  const targeted = spec.lanes.includes('target');
  if (targeted !== (spec.target !== undefined))
    fail(targeted ? 'has a target lane without a target' : 'names a target without the lane');
  if (spec.target !== undefined) checkAssignmentName(spec.target, 'target lane');
  if (spec.blobs?.report) assertBlobLimits(spec.blobs.report, `${spec.id} reports`);
  if (spec.blobs?.brief) {
    assertBlobLimits(spec.blobs.brief, `${spec.id} briefs`);
    if (spec.lanes.includes('device') || spec.lanes.includes('peer'))
      fail('cannot send brief blobs to a device or a peer, whose pull carries no blobs');
  }
  if (spec.accept && 'id' in spec.accept.shape) fail('has an accept input with its own id');
  if (spec.subject !== undefined && !/^[a-z][a-z0-9-]*$/.test(spec.subject))
    fail(`has an invalid subject type "${spec.subject}"`);
  return Object.freeze({
    ...spec,
    accept: (spec.accept ?? z.strictObject({})) as Accept,
    lanes: Object.freeze([...spec.lanes]),
  });
}
