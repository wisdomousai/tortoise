import { DEFAULT_PAGE, own, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { OverdueLoan } from '../contracts/loan-overdue';
import type { AppState } from '../domain';
import { handler, now, type Services } from './context';

/**
 * Open loans due before the time the query runs, oldest due first. Every member sees every loan
 * (the policy's caller gate keeps everyone else out), so the filters run on all rows, then the
 * count, then the page. `dueAt` carries its own offset, so the order compares instants, not text.
 */
export function loanOverdueHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    // #region handler
    handler(operations.loanOverdue, (input, ctx) => {
      const at = now(ctx);
      const due = (loan: { dueAt: string }) => Date.parse(loan.dueAt);
      const rows = Object.values(ctx.state.loans)
        .filter((loan) => loan.returnedAt === undefined)
        .filter((loan) => due(loan) < at)
        .filter((loan) => input.borrower === undefined || loan.borrower === input.borrower)
        .sort((a, b) => due(a) - due(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const offset = input.offset ?? 0;
      const items: OverdueLoan[] = rows
        .slice(offset, offset + (input.limit ?? DEFAULT_PAGE))
        .map((loan) => ({
          ...loan,
          // The loan copies the asset tag; the description lives on the tool.
          description: own(ctx.state.tools, loan.toolId)?.description ?? '',
        }));
      return { items, total: rows.length };
    }),
    // #endregion handler
  ];
}
