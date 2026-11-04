import {
  collectionGetHandler,
  collectionListHandler,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { loans, type Loan } from '../contracts/loan';
import type { AppState } from '../domain';
import type { Services } from './context';

type List = typeof operations.loanList;
type Get = typeof operations.loanGet;
/** Every member sees every loan; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.loans;

/**
 * The generated reads, scoped before filters and counts. Loans have no generated commands:
 * `tool.check-out` and `tool.return` are the only writers.
 */
export function loanHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Loan>(loans, operations.loanList, {
      store,
      visible,
      order: (a, b) => b.checkedOutAt - a.checkedOutAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => `${record.assetTag} ${record.borrower} ${record.workOrder}`,
    }),
    collectionGetHandler<AppState, Services, Get, Loan>(loans, operations.loanGet, {
      store,
      visible,
    }),
  ];
}
