import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { customers, type Customer } from '../contracts/customer';
import type { AppState } from '../domain';
import { assertUnique, newId, now, type Services } from './context';

type List = typeof operations.customerList;
type Get = typeof operations.customerGet;
/** Every member sees every customer; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.customers;

/** Generated reads, scoped before filters and counts, and the generated commands. */
export function customerHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Customer>(customers, operations.customerList, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => `${record.account} ${record.name}`,
    }),
    collectionGetHandler<AppState, Services, Get, Customer>(customers, operations.customerGet, {
      store,
      visible,
    }),
    ...collectionCommandHandlers<AppState, Services, Customer>(
      customers,
      {
        create: operations.customerCreate,
        update: operations.customerUpdate,
      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: who added the utility and when.
        defaults: (ctx) => ({ createdBy: ctx.context.principalId, createdAt: now(ctx) }),
        validate: (record, ctx) =>
          assertUnique(store(ctx.state), record, 'account', 'Customer account'),
      },
    ),
  ];
}
