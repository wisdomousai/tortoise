import { ApplicationError } from '@tortoise/contracts';
import { records, type HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { eamTarget, repairOrderEffect, type RepairOrderPayload } from '../contracts/eam-target';
import { loans } from '../contracts/loan';
import { tools } from '../contracts/tool';
import type { AppState } from '../domain';
import { compact, handler, now, type Services } from './context';

/**
 * Take a tool back. It closes the tool's open loan and moves the tool to available (condition
 * ok) or in-repair (damaged) in one transaction. A damaged return also enqueues the EAM repair
 * order on the loan. A tool that is not checked out has no loan to close and is refused.
 */
export function toolReturnHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.toolReturn, (input, ctx) => {
      const toolRows = records(ctx, tools, ctx.state.tools);
      const tool = toolRows.getExisting(input.toolId, 'Tool unavailable');
      if (tool.status !== 'checked-out')
        throw new ApplicationError('CONFLICT', `Tool is ${tool.status}, not checked out`, {
          id: tool.id,
          status: tool.status,
        });
      const loanRows = records(ctx, loans, ctx.state.loans);
      const open = loanRows
        .values()
        .find((loan) => loan.toolId === tool.id && loan.returnedAt === undefined);
      if (!open)
        throw new ApplicationError('CONFLICT', 'The tool has no open loan', { id: tool.id });
      const trimmed = input.note?.trim();
      const note = trimmed === '' ? undefined : trimmed;
      const returnedBy = ctx.context.principalId;
      const closed = loanRows.update(
        open.id,
        compact({ returnedAt: now(ctx), returnedBy, condition: input.condition, note }),
      );
      toolRows.update(tool.id, { status: input.condition === 'ok' ? 'available' : 'in-repair' });
      // #region enqueue
      if (input.condition === 'damaged') {
        // The repair order commits with the return, so a return the EAM never hears of cannot
        // exist. The dispatcher sends it after the commit and the loan records the EAM's answer.
        const payload: RepairOrderPayload = compact({ assetTag: tool.assetTag, note, returnedBy });
        const effectId = ctx.enqueue({
          target: eamTarget.target,
          type: repairOrderEffect,
          resource: loanRows.resource(open.id),
          payload,
        });
        closed.repairOrder = { effectId, sync: 'pending' };
      }
      // #endregion enqueue
      return closed;
    }),
  ];
}
