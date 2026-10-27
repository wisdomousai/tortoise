import { ApplicationError } from '@agent-native/contracts';
import type { Assignee } from '@agent-native/assignments';
import { byKind, type StoredReport } from '@agent-native/assignments/server';
import { own, type HandlerContribution } from '@agent-native/runtime';
import { captureOperations as ops } from '../contracts/captures';
import { ATTENTION_BELOW, assignmentOperations, reportPlace } from '../contracts/kinds';
import {
  captureBody,
  captureOf,
  captures,
  inScope,
  proposedValues,
  readingOf,
  roleOf,
  surveyBrief,
  surveyScope,
  type ProposedField,
  type SurveyState,
} from '../domain';
import { activeNode } from './structure';
import {
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

const attention = (fields: readonly ProposedField[]) =>
  fields.map((field) => ({ ...field, attention: field.confidence < ATTENTION_BELOW }));

/** A capture as review lists it: the survey report, its node and how its reading stands. */
function captureItem(state: SurveyState, report: StoredReport) {
  const reading = readingOf(state, report.id);
  const fields = (reading?.report?.body.fields ?? []) as ProposedField[];
  return compact({
    id: report.id,
    assignmentId: report.assignmentId,
    nodeId: report.subject,
    ...captureBody(report),
    reportedBy: report.reportedBy,
    reportedAt: report.reportedAt,
    review: report.review,
    reason: report.reason,
    reading: reading?.status,
    attention:
      reading?.status === 'proposed' && fields.some((field) => field.confidence < ATTENTION_BELOW),
  });
}

function existingCapture(ctx: Context, id: string) {
  const report = captureOf(ctx.state, id);
  if (!report) throw new ApplicationError('NOT_FOUND', 'Capture unavailable');
  return report;
}

/** A person assignee must be a member who takes work; device link authenticates devices. */
function checkAssignee(assignee: Assignee, ctx: Context) {
  if (assignee.type !== 'person') return;
  const role = roleOf(ctx.state, assignee.id);
  if (!role || role === 'viewer') invalid('assignee', `${assignee.id} does not take survey work`);
}

/**
 * The hooks of the survey's two assignment kinds.
 *
 * - A survey covers the active subtrees under its roots; its brief is that slice of the
 *   structure as it stands when sent. Accepting a capture writes the reviewer's values onto its
 *   node, each recording the capture and whether the reviewer changed what the model read.
 * - An extraction reads one capture not yet reviewed; its brief is the capture's photos, which
 *   the model's offer carries. Accepting the reading accepts the capture with those values.
 */
export const surveyHooks = {
  newId,
  now,
  ...byKind<Context>({
    survey: {
      assignee: checkAssignee,
      scope(scope, ctx) {
        for (const root of surveyScope({ scope }).roots)
          if (!activeNode(ctx.state, root))
            invalid(
              'scope',
              `${own(ctx.state.nodes, root)?.designation ?? root} is not an active node`,
            );
      },
      brief: (assignment, ctx) => surveyBrief(ctx.state.nodes, surveyScope(assignment)),
      subject: (subject, assignment, ctx) =>
        inScope(ctx.state.nodes, surveyScope(assignment), subject),
      accept(report, input, _assignment, ctx) {
        if (!report.subject) conflict('Place the capture on a node first');
        const node = activeNode(ctx.state, report.subject);
        if (!node) conflict('Node is retired');
        const proposed = proposedValues(readingOf(ctx.state, report.id)?.report);
        nodeRecords(ctx).update(
          node.id,
          (record) => {
            for (const [name, value] of Object.entries(input.values as Record<string, string>))
              record.attributes[name] = {
                value,
                captureId: report.id,
                edited: proposed.get(name) !== value,
              };
          },
          'attributes',
        );
      },
    },
    extraction: {
      assignee: checkAssignee,
      scope(scope, ctx) {
        const capture = existingCapture(ctx, (scope as { reportId: string }).reportId);
        if (capture.review !== 'new') conflict(`Capture is ${capture.review}`);
      },
      brief(assignment, ctx) {
        const reportId = (assignment.scope as { reportId: string }).reportId;
        const body = captureBody(existingCapture(ctx, reportId));
        return { reportId, kind: body.kind, photos: body.photos };
      },
      // Accepting the reading accepts its capture, as the same person in the same transaction.
      async accept(_report, input, assignment, ctx) {
        await ctx.invoke(assignmentOperations.surveyAccept, {
          id: (assignment.scope as { reportId: string }).reportId,
          values: input.values as Record<string, string>,
        });
      },
    },
  }),
};

/** Review's reads over survey reports, the composite place-and-extract, and the assignees. */
export const surveyHandlers = (): HandlerContribution<SurveyState, SurveyServices>[] => [
  handler(ops.captureList, (input, ctx) => ({
    items: captures(ctx.state)
      .filter(
        (report) =>
          (input.assignmentId === undefined || report.assignmentId === input.assignmentId) &&
          (input.nodeId === undefined || report.subject === input.nodeId) &&
          (input.review === undefined || report.review === input.review) &&
          (input.unplaced === undefined || (report.subject === undefined) === input.unplaced),
      )
      .sort((a, b) => captureBody(b).takenAt - captureBody(a).takenAt)
      .map((report) => captureItem(ctx.state, report)),
  })),
  handler(ops.captureGet, (input, ctx) => {
    const report = existingCapture(ctx, input.id);
    const node = report.subject ? own(ctx.state.nodes, report.subject) : undefined;
    const reading = readingOf(ctx.state, report.id);
    const assignee = reading?.extraction.assignee;
    return compact({
      ...captureItem(ctx.state, report),
      accepted: (report.accepted as { values?: Record<string, string> } | undefined)?.values,
      reviewedBy: report.reviewedBy,
      node: node && nodeDto(node),
      extraction:
        reading &&
        compact({
          assignmentId: reading.extraction.id,
          status: reading.status,
          assignee: assignee && `${assignee.type}:${assignee.id}`,
          reportId: reading.report?.id,
          model: reading.report?.body.model as string | undefined,
          fields: attention((reading.report?.body.fields ?? []) as ProposedField[]),
          rejection: reading.extraction.rejection,
        }),
    });
  }),
  // Both calls run in this command's transaction, each with its own authorization.
  handler(ops.placeAndExtract, async (input, ctx) => {
    await ctx.invoke(reportPlace, { id: input.id, subject: input.nodeId });
    const node = nodeRecords(ctx).getExisting(input.nodeId);
    const extraction = await ctx.invoke(assignmentOperations.extractionCreate, {
      title: `Read ${captureBody(existingCapture(ctx, input.id)).kind} on ${node.designation}`,
      scope: { reportId: input.id },
      assignee: { type: 'target', id: 'model' },
    });
    return {
      capture: captureItem(ctx.state, existingCapture(ctx, input.id)),
      extraction: { id: extraction.id },
    };
  }),
  // People who may take survey or extraction work, then the model. Devices come from device link.
  handler(ops.assigneeList, (_input, ctx) => ({
    items: [
      ...Object.entries(ctx.state.members)
        .filter(([, role]) => role !== 'viewer')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, role]) => ({ type: 'person' as const, id, label: `${id} (${role})` })),
      { type: 'target' as const, id: 'model', label: 'Extraction model' },
    ],
  })),
];
