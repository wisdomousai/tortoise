import { ApplicationError, canonicalJson } from '@agent-native/contracts';
import { own, type HandlerContribution } from '@agent-native/runtime';
import { fieldOperations as ops } from '../contracts/captures';
import { ATTENTION_BELOW } from '../contracts/extraction';
import {
  assignmentStage,
  capturesOf,
  deviceIdOf,
  inScope,
  subtree,
  type Assignment,
  type Capture,
  type SurveyState,
} from '../domain';
import {
  assignmentRecords,
  captureRecords,
  compact,
  conflict,
  handler,
  invalid,
  newId,
  nodeDto,
  nodeRecords,
  now,
  type Context,
  type SurveyServices,
} from './context';

export function assignmentDto(state: SurveyState, assignment: Assignment) {
  const { status: _status, ...visible } = assignment;
  return compact({
    ...visible,
    stage: assignmentStage(state, assignment),
    captures: capturesOf(state, assignment.id).length,
  });
}
export function captureDto(state: SurveyState, capture: Capture) {
  return compact({ ...capture, extraction: own(state.extractions, capture.id)?.status });
}

/** A short, stable digest of the feed's content: the cursor changes exactly when it does. */
function feedCursor(items: unknown) {
  let hash = 0x811c9dc5;
  for (const char of canonicalJson(items)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The calling field device, or `FORBIDDEN` for anyone else. */
function callingDevice(ctx: Context) {
  const device = deviceIdOf(ctx.context.principalId);
  if (!device) throw new ApplicationError('FORBIDDEN', 'Only a paired field device may do this');
  return device;
}

function checkedRoots(ctx: Context, roots: string[]) {
  for (const root of roots) {
    const node = nodeRecords(ctx).getExisting(root, `Node ${root} unavailable`);
    if (node.retired || node.source === 'proposed')
      invalid('roots', `${node.designation} is not an active node`);
  }
  return [...new Set(roots)];
}

export const fieldHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  handler(ops.assignmentCreate, (input, ctx) => {
    const id = newId(ctx);
    const assignment = assignmentRecords(ctx).insert(
      id,
      compact({
        id,
        title: input.title,
        roots: checkedRoots(ctx, input.roots),
        kinds: [...new Set(input.kinds)],
        note: input.note,
        status: 'draft' as const,
        createdBy: ctx.context.principalId,
        createdAt: now(ctx),
      }),
      'created',
    );
    return assignmentDto(ctx.state, assignment);
  }),
  handler(ops.assignmentDispatch, (input, ctx) => {
    const assignments = assignmentRecords(ctx);
    const assignment = assignments.getExisting(input.id);
    if (assignment.status !== 'draft') conflict(`Assignment is ${assignment.status}`);
    assignments.update(
      input.id,
      { status: 'dispatched', deviceId: input.deviceId, dispatchedAt: now(ctx) },
      'dispatched',
    );
    return assignmentDto(ctx.state, assignment);
  }),
  handler(ops.assignmentReturn, (input, ctx) => {
    const assignments = assignmentRecords(ctx);
    const assignment = assignments.getExisting(input.id);
    const device = deviceIdOf(ctx.context.principalId);
    // A device returns only what was dispatched to it; to anyone else it does not exist.
    if (device !== undefined && assignment.deviceId !== device)
      throw new ApplicationError('NOT_FOUND', 'Assignment unavailable');
    if (assignment.status === 'returned') return assignmentDto(ctx.state, assignment);
    if (assignment.status !== 'dispatched') conflict(`Assignment is ${assignment.status}`);
    assignments.update(input.id, { status: 'returned', returnedAt: now(ctx) }, 'returned');
    return assignmentDto(ctx.state, assignment);
  }),
  handler(ops.assignmentList, (_input, ctx) => ({
    items: Object.values(ctx.state.assignments)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((assignment) => assignmentDto(ctx.state, assignment)),
  })),
  handler(ops.assignmentFeed, (input, ctx) => {
    const device = callingDevice(ctx);
    const items = Object.values(ctx.state.assignments)
      .filter((assignment) => assignment.deviceId === device && assignment.status !== 'draft')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((assignment) => {
        const nodes = new Map(
          assignment.roots
            .flatMap((root) => subtree(ctx.state, root))
            .map((node) => [node.id, node]),
        );
        return compact({
          id: assignment.id,
          title: assignment.title,
          kinds: assignment.kinds,
          note: assignment.note,
          returned: assignment.status === 'returned',
          nodes: [...nodes.values()].map(({ id, parentId, scheme, designation, name }) =>
            // A root's parent is outside the slice; the device sees it as a root.
            compact({
              id,
              parentId: parentId && nodes.has(parentId) ? parentId : undefined,
              scheme,
              designation,
              name,
            }),
          ),
        });
      });
    const cursor = feedCursor(items);
    return { items: input.cursor === cursor ? [] : items, cursor, more: false };
  }),
  handler(ops.captureIngest, (input, ctx) => {
    const device = callingDevice(ctx);
    const assignment = own(ctx.state.assignments, input.assignmentId);
    if (!assignment || assignment.deviceId !== device || assignment.status === 'draft')
      throw new ApplicationError('FORBIDDEN', 'The assignment is not dispatched to this device');
    const captures = captureRecords(ctx);
    // A node outside the assignment (retired since the device synced, say) arrives unplaced.
    const nodeId =
      input.nodeId !== undefined && inScope(ctx.state, assignment, input.nodeId)
        ? input.nodeId
        : undefined;
    const existing = captures.get(input.id);
    if (existing) {
      const same =
        existing.deviceId === device &&
        canonicalJson(existing.photos) === canonicalJson(input.photos) &&
        existing.takenAt === input.takenAt;
      if (!same) conflict('Another capture has this ID');
      return { id: input.id };
    }
    for (const photo of input.photos) ctx.attach(captures.resource(input.id), photo);
    captures.insert(
      input.id,
      compact({ ...input, nodeId, deviceId: device, receivedAt: now(ctx), review: 'new' as const }),
      'ingested',
    );
    assignmentRecords(ctx).touch(assignment.id);
    return { id: input.id };
  }),
  handler(ops.captureList, (input, ctx) => ({
    items: Object.values(ctx.state.captures)
      .filter(
        (capture) =>
          (input.assignmentId === undefined || capture.assignmentId === input.assignmentId) &&
          (input.nodeId === undefined || capture.nodeId === input.nodeId) &&
          (input.review === undefined || capture.review === input.review) &&
          (input.unplaced === undefined || (capture.nodeId === undefined) === input.unplaced),
      )
      .sort((a, b) => b.takenAt - a.takenAt)
      .map((capture) => captureDto(ctx.state, capture)),
  })),
  handler(ops.captureGet, (input, ctx) => {
    const capture = captureRecords(ctx).getExisting(input.id);
    const extraction = own(ctx.state.extractions, capture.id);
    const node = capture.nodeId ? own(ctx.state.nodes, capture.nodeId) : undefined;
    return compact({
      ...capture,
      node: node && nodeDto(node),
      extraction:
        extraction &&
        compact({
          captureId: extraction.captureId,
          status: extraction.status,
          model: extraction.model,
          accepted: extraction.accepted,
          acceptedBy: extraction.acceptedBy,
          rejection: extraction.rejection,
          fields: extraction.fields.map((field) => ({
            ...field,
            attention: field.confidence < ATTENTION_BELOW,
          })),
        }),
    });
  }),
  handler(ops.capturePlace, (input, ctx) => {
    const captures = captureRecords(ctx);
    const capture = captures.getExisting(input.id);
    if (capture.review === 'discarded') conflict('Capture is discarded');
    const node = nodeRecords(ctx).getExisting(input.nodeId);
    if (node.retired || node.source === 'proposed') invalid('nodeId', 'Node is not active');
    captures.update(input.id, { nodeId: node.id }, 'placed');
    return captureDto(ctx.state, capture);
  }),
  handler(ops.captureDiscard, (input, ctx) => {
    const captures = captureRecords(ctx);
    const capture = captures.getExisting(input.id);
    if (capture.review === 'reviewed') conflict('Capture is reviewed');
    captures.update(input.id, { review: 'discarded', discardReason: input.reason }, 'discarded');
    return captureDto(ctx.state, capture);
  }),
];
