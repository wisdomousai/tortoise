import { ApplicationError, canonicalJson, type AnyCapability } from '@tortoise/contracts';
import { own, put } from '@tortoise/runtime';
import type { AnyAssignmentKind } from '../kind';
import type { Assignments } from '../manifest';
import { camel } from '../operations';
import type { StoredBody } from '../schemas';
import { handler, missing, now, type Ctx, type Handler } from './issue';
import { canSee, canSeeReport, isAssignee } from './policy';
import {
  assignmentResource,
  blobRefsOf,
  presentReport,
  reportResource,
  type StoredAssignment,
  type StoredReport,
} from './slice';

const conflict = (message: string) => new ApplicationError('CONFLICT', message);
const invalid = (message: string, field: string) =>
  new ApplicationError('INVALID_INPUT', message, { field });

/** A report the caller may see, or NOT_FOUND. */
function visibleReport(ctx: Ctx, id: string): StoredReport {
  const found = own(ctx.state.reports, id);
  if (!found || !canSeeReport(ctx.context, ctx.access, ctx.state, found))
    throw new ApplicationError('NOT_FOUND', 'Report unavailable');
  return found;
}
const covers = (ctx: Ctx, kind: string, subject: string, assignment: StoredAssignment) =>
  ctx.hooks.subject?.(kind, subject, assignment) !== false;
/** A device or a peer reports from its own copy of the instructions, which may be out of date. */
const remote = (assignment: StoredAssignment) =>
  assignment.assignee?.type === 'device' || assignment.assignee?.type === 'peer';

/** What a report entry holds before it is stored. */
export interface ReportEntry {
  readonly id: string;
  readonly subject?: string;
  readonly body: StoredBody;
}

/**
 * Store one report on a sent or done assignment. A done one still takes reports, because an
 * assignee's report can reach the issuer after its done mark when its delivery was retried. The
 * same report again, from the same reporter with the same body, returns the stored one and
 * changes nothing, even after a reviewer linked it to another subject; a different one under the
 * same ID conflicts. `attach` attaches the body's blobs to the report, which only a command
 * declaring the kind's report blob limits may do.
 */
export function storeReport(
  ctx: Ctx,
  assignment: StoredAssignment,
  entry: ReportEntry,
  attach: boolean,
): StoredReport {
  const existing = own(ctx.state.reports, entry.id);
  if (existing) {
    const same =
      existing.assignmentId === assignment.id &&
      existing.reportedBy === ctx.context.principalId &&
      canonicalJson(existing.body) === canonicalJson(entry.body);
    if (!same) throw conflict('A different report has this ID');
    return existing;
  }
  if (assignment.status !== 'sent' && assignment.status !== 'done')
    throw conflict(`The assignment is ${assignment.status}; it takes no reports`);
  const report: StoredReport = {
    id: entry.id,
    assignmentId: assignment.id,
    kind: assignment.kind,
    ...(entry.subject === undefined ? {} : { subject: entry.subject }),
    body: entry.body,
    reportedBy: ctx.context.principalId,
    ...(ctx.context.runId === undefined ? {} : { runId: ctx.context.runId }),
    reportedAt: now(ctx),
    review: 'new',
  };
  put(ctx.state.reports, report.id, report);
  const resource = reportResource(report.id);
  if (attach) for (const ref of blobRefsOf(report.body)) ctx.attach(resource, ref);
  ctx.change(resource, 'created');
  ctx.change(assignmentResource(assignment.id), 'reported');
  return report;
}

/** Report and accept, per kind. */
export function kindReportHandlers(assignments: Assignments, kind: AnyAssignmentKind): Handler[] {
  const operations = assignments.operations as unknown as Record<string, AnyCapability>;
  return [
    handler<{ id: string; assignmentId: string; subject?: string; body: StoredBody }>(
      operations[`${camel(kind.id)}Report`]!,
      (input, ctx) => {
        const assignment = own(ctx.state.assignments, input.assignmentId);
        if (
          !assignment ||
          !isAssignee(ctx.context, assignment.assignee) ||
          !canSee(ctx.context, ctx.access, assignment)
        )
          throw missing();
        if (assignment.kind !== kind.id)
          throw invalid(`The assignment is not ${kind.title} work`, 'assignmentId');
        const { subject, ...entry } = input;
        const covered = subject === undefined || covers(ctx, kind.id, subject, assignment);
        // A record that left the assignment after a device or a peer copied the instructions keeps its
        // report, unlinked, for a person to link; a caller on this instance is refused instead.
        if (!covered && !remote(assignment))
          throw invalid('The assignment does not cover this record', 'subject');
        return presentReport(
          storeReport(ctx, assignment, covered && subject ? { ...entry, subject } : entry, true),
        );
      },
    ),
    handler<{ id: string } & StoredBody>(
      operations[`${camel(kind.id)}Accept`]!,
      async (input, ctx) => {
        const report = visibleReport(ctx, input.id);
        if (report.kind !== kind.id) throw invalid(`The report is not on ${kind.title} work`, 'id');
        if (report.review !== 'new') throw conflict(`The report is already ${report.review}`);
        const { id: _id, ...given } = input;
        const assignment = own(ctx.state.assignments, report.assignmentId)!;
        // The application's records change in this transaction; a throw refuses the accept.
        await ctx.hooks.accept?.(kind.id, report, given, assignment);
        report.review = 'accepted';
        report.reviewedBy = ctx.context.principalId;
        report.reviewedAt = now(ctx);
        if (Object.keys(given).length) report.accepted = given;
        ctx.change(reportResource(report.id), 'accepted');
        ctx.change(assignmentResource(assignment.id), 'reviewed');
        return presentReport(report);
      },
    ),
  ];
}

/** The report reads, linking and discarding. */
export function genericReportHandlers(assignments: Assignments): Handler[] {
  const ops = assignments.operations;
  const kinds = new Map(assignments.kinds.map((kind) => [kind.id, kind]));
  const review = (ctx: Ctx, id: string) => {
    const report = visibleReport(ctx, id);
    if (report.review !== 'new') throw conflict(`The report is already ${report.review}`);
    return report;
  };
  return [
    handler<{
      assignmentId?: string;
      kind?: string;
      review?: string;
      subject?: string;
      offset?: number;
      limit?: number;
    }>(ops.reportList, (input, ctx) => {
      const items = Object.values(ctx.state.reports)
        .filter(
          (report) =>
            canSeeReport(ctx.context, ctx.access, ctx.state, report) &&
            (input.assignmentId === undefined || report.assignmentId === input.assignmentId) &&
            (input.kind === undefined || report.kind === input.kind) &&
            (input.review === undefined || report.review === input.review) &&
            (input.subject === undefined || report.subject === input.subject),
        )
        .sort((a, b) => b.reportedAt - a.reportedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const offset = input.offset ?? 0;
      return {
        items: items.slice(offset, offset + (input.limit ?? 50)).map(presentReport),
        total: items.length,
      };
    }),
    handler<{ id: string }>(ops.reportGet, (input, ctx) =>
      presentReport(visibleReport(ctx, input.id)),
    ),
    handler<{ id: string; reason?: string }>(ops.reportDiscard, (input, ctx) => {
      const report = review(ctx, input.id);
      report.review = 'discarded';
      report.reviewedBy = ctx.context.principalId;
      report.reviewedAt = now(ctx);
      if (input.reason !== undefined) report.reason = input.reason;
      ctx.change(reportResource(report.id), 'discarded');
      ctx.change(assignmentResource(report.assignmentId), 'reviewed');
      return presentReport(report);
    }),
    ...(ops.reportLink
      ? [
          handler<{ id: string; subject: string }>(ops.reportLink, (input, ctx) => {
            const report = review(ctx, input.id);
            if (kinds.get(report.kind)?.subject === undefined)
              throw invalid('Reports of this kind name no record', 'id');
            const assignment = own(ctx.state.assignments, report.assignmentId)!;
            if (!covers(ctx, report.kind, input.subject, assignment))
              throw invalid('The assignment does not cover this record', 'subject');
            report.subject = input.subject;
            ctx.change(reportResource(report.id), 'linked');
            return presentReport(report);
          }),
        ]
      : []),
  ];
}
