import { ApplicationError } from '@agent-native/contracts';
import { records, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { loans, type Loan } from '../contracts/loan';
import { tools } from '../contracts/tool';
import type { AppState } from '../domain';
import { handler, newId, now, type Services } from './context';

/**
 * Lend an available tool. The tool and the new loan change in this one transaction, and both
 * resources are declared, so a caller's `expectedRevisions` for `tool:<id>` is checked and a
 * second check-out of the same tool finds it already checked out.
 */
export function toolCheckOutHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    // #region handler
    handler(operations.toolCheckOut, (input, ctx) => {
      const workOrder = input.workOrder.trim();
      if (workOrder === '')
        throw new ApplicationError('INVALID_INPUT', 'Work order cannot be blank', {
          field: 'workOrder',
        });
      const toolRows = records(ctx, tools, ctx.state.tools);
      const tool = toolRows.getExisting(input.toolId, 'Tool unavailable');
      if (tool.status !== 'available')
        throw new ApplicationError('CONFLICT', `Tool is ${tool.status}, not available`, {
          id: tool.id,
          status: tool.status,
        });
      const loan: Loan = {
        id: newId(ctx),
        toolId: tool.id,
        assetTag: tool.assetTag,
        borrower: input.borrower,
        workOrder,
        dueAt: input.dueAt,
        checkedOutBy: ctx.context.principalId,
        checkedOutAt: now(ctx),
      };
      records(ctx, loans, ctx.state.loans).insert(loan.id, loan);
      toolRows.update(tool.id, { status: 'checked-out' });
      return loan;
    }),
    // #endregion handler
  ];
}
