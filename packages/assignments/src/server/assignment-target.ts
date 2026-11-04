import { ApplicationError, type SyncBatch } from '@tortoise/contracts';
import { targetHandlers, type TargetCursor } from '@tortoise/integration';
import { own, put } from '@tortoise/runtime';
import type { AnyAssignmentKind } from '../kind';
import type { AssignmentTarget } from '../manifest';
import type { StoredBody } from '../schemas';
import { now, type Ctx, type Handler } from './issue';
import { canSee } from './policy';
import { storeReport } from './report';
import { assignmentResource, type AssignmentSlice } from './slice';

/** One target result as the target's sync receives it. */
export interface TargetResult {
  readonly assignmentId: string;
  readonly effectId: string;
  readonly reports: readonly {
    readonly id: string;
    readonly subject?: string;
    readonly body: StoredBody;
  }[];
}

/**
 * The handlers of one assignment target. Completing records whether the target took the offer. Syncing
 * applies each result to the offer it names: its reports are stored and the assignment is done.
 * A result for an older offer, or for an assignment no longer sent, is ignored, and so is a
 * report whose body the kind refuses or whose ID is taken. A subject the assignment does not
 * cover is dropped, so a person links that report.
 */
export function assignmentTargetHandlers(
  name: string,
  target: AssignmentTarget,
  kinds: ReadonlyMap<string, AnyAssignmentKind>,
): Handler[] {
  // The watermark is stored on the target's first sync, so the status query reads without writing.
  const cursor = (slice: AssignmentSlice): TargetCursor => own(slice.targets, name) ?? {};
  const handlers = targetHandlers<AssignmentSlice, unknown, TargetResult, unknown, object>(target, {
    cursor,
    now: (ctx) => now(ctx as Ctx),
    onOutcome(effect, outcome, ctx) {
      const assignment = own(ctx.state.assignments, effect.resource.slice('assignment:'.length));
      if (!assignment || assignment.effectId !== effect.id)
        throw new ApplicationError('NOT_FOUND', 'Forwarded record unavailable');
      assignment.delivery = outcome.status;
      if (outcome.status === 'rejected')
        assignment.rejection = { code: outcome.code, message: outcome.message };
    },
    applyBatch(batch: SyncBatch<TargetResult, unknown>, context) {
      const ctx = context as Ctx;
      let applied = 0;
      for (const result of batch.items) {
        const assignment = own(ctx.state.assignments, result.assignmentId);
        if (!assignment || assignment.effectId !== result.effectId || assignment.status !== 'sent')
          continue;
        const kind = kinds.get(assignment.kind)!;
        for (const entry of result.reports) {
          if (own(ctx.state.reports, entry.id) || !kind.report.safeParse(entry.body).success)
            continue;
          const covered =
            entry.subject !== undefined &&
            ctx.hooks.subject?.(kind.id, entry.subject, assignment) !== false;
          storeReport(
            ctx,
            assignment,
            { id: entry.id, body: entry.body, ...(covered ? { subject: entry.subject } : {}) },
            false,
          );
        }
        assignment.status = 'done';
        assignment.doneBy = ctx.context.principalId;
        assignment.doneAt = now(ctx);
        ctx.change(assignmentResource(assignment.id), 'done');
        applied++;
      }
      return applied;
    },
    status(context) {
      const ctx = context as Ctx;
      const offers = Object.values(ctx.state.assignments).filter(
        (assignment) =>
          assignment.status === 'sent' &&
          assignment.assignee?.type === 'target' &&
          assignment.assignee.id === name &&
          canSee(ctx.context, ctx.access, assignment),
      );
      return {
        waiting: offers.filter((offer) => offer.delivery !== 'rejected').length,
        refused: offers.filter((offer) => offer.delivery === 'rejected').length,
      };
    },
  });
  return (handlers as unknown as Handler[]).map((entry) =>
    entry.capability.id !== target.sync?.id
      ? entry
      : {
          ...entry,
          handle: (input: unknown, ctx: Ctx) => {
            if (!own(ctx.state.targets, name)) put(ctx.state.targets, name, {});
            return entry.handle(input, ctx);
          },
        },
  );
}
