import type { z } from 'zod';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import { targetHandlers } from '@agent-native/integration';
import { own, records, type HandlerContext, type HandlerContribution } from '@agent-native/runtime';
import type { fieldAssignmentSchema } from '@agent-native/asset-survey/contracts/schemas';
import { fieldOperations as ops, hubTarget } from './contracts';
import { isClosed, matches, slice, type FieldAssignment, type FieldState } from './domain';

export interface FieldServices {
  now?: () => number;
}
type Context = HandlerContext<FieldState, FieldServices>;
const now = (ctx: Context) => (ctx.services.now ?? Date.now)();

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const label = (one: string, many: string) => ({ one, many });
const assignmentRecords = (ctx: Context) =>
  records(
    ctx,
    { type: 'assignment', label: label('Assignment', 'Assignments') },
    ctx.state.assignments,
  );
const captureRecords = (ctx: Context) =>
  records(ctx, { type: 'capture', label: label('Capture', 'Captures') }, ctx.state.captures);

function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<FieldState, FieldServices, C> {
  return { capability, handle };
}

function assignmentDto(state: FieldState, assignment: FieldAssignment) {
  const sent = own(state.returns, assignment.id);
  return compact({
    id: assignment.id,
    title: assignment.title,
    kinds: assignment.kinds,
    note: assignment.note,
    nodes: assignment.nodes.length,
    captures: Object.values(state.captures).filter(
      (capture) => capture.assignmentId === assignment.id,
    ).length,
    returned: isClosed(state, assignment),
    returnSync: sent?.sync,
  });
}
const captureDto = (capture: FieldState['captures'][string]) => {
  const { effectId: _effect, ...visible } = capture;
  return compact(visible);
};

/** An open assignment of this device; a returned one takes no more captures. */
function openAssignment(ctx: Context, id: string) {
  const assignment = assignmentRecords(ctx).getExisting(id);
  if (isClosed(ctx.state, assignment))
    throw new ApplicationError('CONFLICT', 'The assignment is returned');
  return assignment;
}

export const createFieldHandlers = (): HandlerContribution<FieldState, FieldServices>[] => [
  handler(ops.assignmentList, (_input, ctx) => ({
    items: Object.values(ctx.state.assignments).map((assignment) =>
      assignmentDto(ctx.state, assignment),
    ),
  })),
  handler(ops.nodeList, (input, ctx) => {
    const assignment = assignmentRecords(ctx).getExisting(input.assignmentId);
    const counts = new Map<string, number>();
    for (const capture of Object.values(ctx.state.captures))
      if (capture.nodeId) counts.set(capture.nodeId, (counts.get(capture.nodeId) ?? 0) + 1);
    return {
      items: slice(assignment)
        .filter((node) => matches(node, input.q ?? ''))
        .map((node) => compact({ ...node, captures: counts.get(node.id) ?? 0 })),
    };
  }),
  handler(ops.captureRecord, (input, ctx) => {
    const assignment = openAssignment(ctx, input.assignmentId);
    if (input.nodeId !== undefined && !assignment.nodes.some((node) => node.id === input.nodeId))
      throw new ApplicationError('INVALID_INPUT', 'The node is not part of this assignment', {
        field: 'nodeId',
      });
    const captures = captureRecords(ctx);
    if (captures.get(input.id)) throw new ApplicationError('CONFLICT', 'Capture already recorded');
    const resource = captures.resource(input.id);
    // The photos stay readable through the capture, so the hub connector can upload them.
    for (const photo of input.photos) ctx.attach(resource, photo);
    // The payload is the hub's `capture.ingest` input, so the peer port delivers it unchanged.
    const effectId = ctx.enqueue({
      target: hubTarget.target,
      type: 'capture.ingest',
      resource,
      payload: { ...input, photos: input.photos.map((photo) => ({ ...photo })) },
    });
    const capture = captures.insert(
      input.id,
      compact({ ...input, effectId, sync: 'pending' as const }),
      'recorded',
    );
    return captureDto(capture);
  }),
  handler(ops.captureList, (input, ctx) => ({
    items: Object.values(ctx.state.captures)
      .filter(
        (capture) =>
          (input.assignmentId === undefined || capture.assignmentId === input.assignmentId) &&
          (input.unplaced === undefined || (capture.nodeId === undefined) === input.unplaced),
      )
      .sort((a, b) => b.takenAt - a.takenAt)
      .map(captureDto),
  })),
  handler(ops.assignmentReturn, (input, ctx) => {
    const assignment = openAssignment(ctx, input.id);
    const resource = assignmentRecords(ctx).resource(assignment.id);
    // Enqueued after every capture of the assignment. The dispatcher delivers in that order
    // while no delivery fails, so the hub normally sees the captures before the return.
    const effectId = ctx.enqueue({
      target: hubTarget.target,
      type: 'assignment.return',
      resource,
      payload: { id: assignment.id },
    });
    ctx.state.returns[assignment.id] = { effectId, sync: 'pending' };
    assignmentRecords(ctx).touch(assignment.id);
    return assignmentDto(ctx.state, assignment);
  }),
  ...targetHandlers<FieldState, FieldServices, z.output<typeof fieldAssignmentSchema>>(hubTarget, {
    cursor: (state) => state.cursor,
    now,
    onOutcome(effect, outcome, ctx) {
      const result = compact({
        sync: outcome.status,
        rejection:
          outcome.status === 'rejected'
            ? { code: outcome.code, message: outcome.message }
            : undefined,
      });
      if (effect.type === 'capture.ingest') {
        const id = effect.resource.slice('capture:'.length);
        captureRecords(ctx).update(id, (capture) => Object.assign(capture, result), outcome.status);
        return;
      }
      const id = effect.resource.slice('assignment:'.length);
      const sent = own(ctx.state.returns, id);
      if (!sent || sent.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Return unavailable');
      // A refused return reopens the assignment, so the device can keep working on it.
      if (outcome.status === 'rejected') delete ctx.state.returns[id];
      else Object.assign(sent, result);
      assignmentRecords(ctx).touch(id);
    },
    applyBatch({ items }, ctx) {
      // The hub sends every assignment of this device whenever any of them changes.
      for (const item of items)
        assignmentRecords(ctx).set(
          item.id,
          compact({
            id: item.id,
            title: item.title,
            kinds: item.kinds,
            note: item.note,
            returned: item.returned,
            nodes: item.nodes,
          }),
          'synced',
        );
      return items.length;
    },
    status(ctx) {
      const all = [...Object.values(ctx.state.captures), ...Object.values(ctx.state.returns)];
      const count = (sync: string) => all.filter((record) => record.sync === sync).length;
      return {
        pending: count('pending'),
        accepted: count('accepted'),
        rejected: count('rejected'),
      };
    },
  }),
];
