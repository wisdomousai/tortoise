import { ApplicationError, type AnyCapability } from '@agent-native/contracts';
import { own, put, type FeatureHandler, type FeatureHandlerContext } from '@agent-native/runtime';
import type { AnyAssignmentKind } from '../kind';
import { offerEventType, type Assignments } from '../manifest';
import { camel, targetOf } from '../operations';
import { MAX_OPEN, type Assignee, type StoredBody } from '../schemas';
import type { AssignmentAccess, AssignmentHooks } from './hooks';
import { canSee, isAssignee } from './policy';
import {
  assignmentResource,
  blobRefsOf,
  feedCursor,
  present,
  reportCounts,
  type AssignmentSlice,
  type StoredAssignment,
} from './slice';

export type Ctx = FeatureHandlerContext<
  AssignmentSlice,
  unknown,
  AssignmentAccess,
  AssignmentHooks
>;
export type Handler = FeatureHandler<AssignmentSlice, unknown, AssignmentAccess, AssignmentHooks>;

export const handler = <I>(
  capability: AnyCapability,
  handle: (input: I, ctx: Ctx) => unknown,
): Handler => ({ capability, handle: handle as Handler['handle'] });
export const now = (ctx: Ctx) => ctx.hooks.now?.() ?? Date.now();
export const missing = () => new ApplicationError('NOT_FOUND', 'Assignment unavailable');
const conflict = (message: string) => new ApplicationError('CONFLICT', message);
const invalid = (message: string, field: string) =>
  new ApplicationError('INVALID_INPUT', message, { field });

/** An assignment the caller may see, or NOT_FOUND. */
export function visible(ctx: Ctx, id: string): StoredAssignment {
  const found = own(ctx.state.assignments, id);
  if (!found || !canSee(ctx.context, ctx.access, found)) throw missing();
  return found;
}
const shown = (ctx: Ctx, assignment: StoredAssignment) =>
  present(assignment, reportCounts(ctx.state));
const sameAssignee = (a: Assignee | undefined, b: Assignee) => a?.type === b.type && a.id === b.id;

/**
 * Send an assignment: compute and check its brief, attach the brief's blobs, and for an
 * assignment target enqueue the offer. An agent's offer carries its own event type, which a trigger filters on.
 */
function send(kind: AnyAssignmentKind, assignment: StoredAssignment, assignee: Assignee, ctx: Ctx) {
  if (!kind.assigneeTypes.includes(assignee.type))
    throw invalid(`${kind.title} work does not go to a ${assignee.type}`, 'assignee');
  if (assignee.type === 'target' && assignee.id !== kind.target)
    throw invalid(`${kind.title} work goes to the target ${kind.target}`, 'assignee');
  ctx.hooks.assignee?.(kind.id, assignee);
  const open = Object.values(ctx.state.assignments).filter(
    (other) => other.status === 'sent' && sameAssignee(other.assignee, assignee),
  ).length;
  if (open >= MAX_OPEN) throw conflict(`The assignee already holds ${MAX_OPEN} open assignments`);
  assignment.assignee = assignee;
  const parsed = kind.brief.safeParse(ctx.hooks.brief?.(kind.id, assignment) ?? assignment.scope);
  if (!parsed.success) throw invalid(`The scope does not make a ${kind.title} brief`, 'scope');
  const brief = parsed.data as StoredBody;
  const resource = assignmentResource(assignment.id);
  for (const ref of blobRefsOf(brief)) ctx.attach(resource, ref);
  assignment.brief = brief;
  assignment.status = 'sent';
  assignment.sentAt = now(ctx);
  ctx.change(resource, assignee.type === 'agent' ? offerEventType(assignee.id) : 'sent');
  if (assignee.type !== 'target') return;
  assignment.effectId = ctx.enqueue({
    target: targetOf(assignee.id),
    type: 'assignment.offer',
    resource,
    payload: {
      assignmentId: assignment.id,
      kind: kind.id,
      title: assignment.title,
      ...(assignment.note === undefined ? {} : { note: assignment.note }),
      brief,
    },
  });
  assignment.delivery = 'pending';
  delete assignment.rejection;
}

/** Create and send, per kind. */
export function kindIssueHandlers(assignments: Assignments, kind: AnyAssignmentKind): Handler[] {
  const operations = assignments.operations as unknown as Record<string, AnyCapability>;
  const key = (op: string) => `${camel(kind.id)}${op}`;
  return [
    handler<{ title: string; note?: string; scope: StoredBody; assignee?: Assignee }>(
      operations[key('Create')]!,
      (input, ctx) => {
        ctx.hooks.scope?.(kind.id, input.scope);
        const id = ctx.hooks.newId?.() ?? crypto.randomUUID();
        if (own(ctx.state.assignments, id)) throw conflict('An assignment with this ID exists');
        const assignment: StoredAssignment = {
          id,
          kind: kind.id,
          title: input.title,
          ...(input.note === undefined ? {} : { note: input.note }),
          scope: input.scope,
          status: 'draft',
          createdBy: ctx.context.principalId,
          createdAt: now(ctx),
        };
        put(ctx.state.assignments, id, assignment);
        ctx.change(assignmentResource(id), 'created');
        if (input.assignee) send(kind, assignment, input.assignee, ctx);
        return shown(ctx, assignment);
      },
    ),
    handler<{ id: string; assignee: Assignee }>(operations[key('Send')]!, (input, ctx) => {
      const assignment = visible(ctx, input.id);
      if (assignment.kind !== kind.id)
        throw invalid(`The assignment is not ${kind.title} work`, 'id');
      if (assignment.status !== 'draft') throw conflict(`The assignment is ${assignment.status}`);
      send(kind, assignment, input.assignee, ctx);
      return shown(ctx, assignment);
    }),
  ];
}

const newestFirst = (a: StoredAssignment, b: StoredAssignment) =>
  b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Withdraw, complete, close, list, get and the feed. */
export function genericIssueHandlers(assignments: Assignments): Handler[] {
  const ops = assignments.operations;
  return [
    handler<{ id: string; reason?: string }>(ops.withdraw, (input, ctx) => {
      const assignment = visible(ctx, input.id);
      if (assignment.status !== 'draft' && assignment.status !== 'sent')
        throw conflict(`The assignment is ${assignment.status}`);
      const effect = assignment.effectId
        ? ctx.effects({ status: 'pending' }).find((one) => one.id === assignment.effectId)
        : undefined;
      // An offer no worker claimed yet is never sent; a claimed one may already be with the
      // target, whose result is then ignored because the assignment is no longer sent.
      if (effect && !effect.claim) ctx.cancelEffect(effect.id, 'The assignment was withdrawn');
      assignment.status = 'withdrawn';
      if (input.reason !== undefined) assignment.reason = input.reason;
      assignment.closedBy = ctx.context.principalId;
      assignment.closedAt = now(ctx);
      ctx.change(assignmentResource(assignment.id), 'withdrawn');
      return shown(ctx, assignment);
    }),
    handler<{ id: string }>(ops.complete, (input, ctx) => {
      const assignment = visible(ctx, input.id);
      // Marking done twice is harmless, as a device that lost the receipt does.
      if (assignment.status === 'done') return shown(ctx, assignment);
      if (assignment.status !== 'sent') throw conflict(`The assignment is ${assignment.status}`);
      assignment.status = 'done';
      assignment.doneBy = ctx.context.principalId;
      assignment.doneAt = now(ctx);
      ctx.change(assignmentResource(assignment.id), 'done');
      return shown(ctx, assignment);
    }),
    handler<{ id: string }>(ops.close, (input, ctx) => {
      const assignment = visible(ctx, input.id);
      if (assignment.status === 'closed') return shown(ctx, assignment);
      if (assignment.status !== 'done') throw conflict('Only a done assignment is closed');
      assignment.status = 'closed';
      assignment.closedBy = ctx.context.principalId;
      assignment.closedAt = now(ctx);
      ctx.change(assignmentResource(assignment.id), 'closed');
      return shown(ctx, assignment);
    }),
    handler<{
      kind?: string;
      stage?: string;
      assigneeType?: string;
      assigneeId?: string;
      offset?: number;
      limit?: number;
    }>(ops.list, (input, ctx) => {
      const counts = reportCounts(ctx.state);
      // Scoping comes first, so the total counts visible assignments only.
      const items = Object.values(ctx.state.assignments)
        .filter((assignment) => canSee(ctx.context, ctx.access, assignment))
        .map((assignment) => present(assignment, counts))
        .filter(
          (item) =>
            (input.kind === undefined || item.kind === input.kind) &&
            (input.stage === undefined || item.stage === input.stage) &&
            (input.assigneeType === undefined ||
              (item.assignee as Assignee | undefined)?.type === input.assigneeType) &&
            (input.assigneeId === undefined ||
              (item.assignee as Assignee | undefined)?.id === input.assigneeId),
        )
        .sort((a, b) => newestFirst(a as never, b as never));
      const offset = input.offset ?? 0;
      return { items: items.slice(offset, offset + (input.limit ?? 50)), total: items.length };
    }),
    handler<{ id: string }>(ops.get, (input, ctx) => shown(ctx, visible(ctx, input.id))),
    handler<{ cursor?: string }>(ops.feed, (input, ctx) => {
      const items = Object.values(ctx.state.assignments)
        .filter(
          (assignment) =>
            assignment.status === 'sent' &&
            isAssignee(ctx.context, assignment.assignee) &&
            canSee(ctx.context, ctx.access, assignment),
        )
        .sort((a, b) => a.sentAt! - b.sentAt! || (a.id < b.id ? -1 : 1))
        .map((assignment) => ({
          id: assignment.id,
          kind: assignment.kind,
          title: assignment.title,
          ...(assignment.note === undefined ? {} : { note: assignment.note }),
          brief: assignment.brief!,
          sentAt: assignment.sentAt!,
        }));
      // The whole open set each time: an assignee drops what is absent, so a withdrawal reaches it.
      const cursor = feedCursor(items);
      return { items: input.cursor === cursor ? [] : items, cursor, more: false };
    }),
  ];
}
