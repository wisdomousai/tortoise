import { ApplicationError } from '@agent-native/contracts';
import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
  own,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { transformers, type Transformer } from '../contracts/transformer';
import type { AppState } from '../domain';
import { assertUnique, newId, now, type Services } from './context';

type List = typeof operations.transformerList;
type Get = typeof operations.transformerGet;
/** Every member sees every transformer; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.transformers;

/** The transformer with this serial, compared in upper case, or undefined. */
export function transformerBySerial(state: AppState, serial: string): Transformer | undefined {
  const wanted = serial.trim().toUpperCase();
  return Object.values(state.transformers).find((record) => record.serial === wanted);
}

/** The utility a record names, or NOT_FOUND on its `customerId` field. */
export function requireCustomer(state: AppState, customerId: string) {
  const customer = own(state.customers, customerId);
  if (!customer)
    throw new ApplicationError('NOT_FOUND', 'Customer unavailable', { field: 'customerId' });
  return customer;
}

/** Generated reads, scoped before filters and counts, and the generated commands. */
export function transformerHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Transformer>(
      transformers,
      operations.transformerList,
      {
        store,
        visible,
        order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        searchText: (record) => `${record.serial} ${record.substation}`,
      },
    ),
    collectionGetHandler<AppState, Services, Get, Transformer>(
      transformers,
      operations.transformerGet,
      { store, visible },
    ),
    ...collectionCommandHandlers<AppState, Services, Transformer>(
      transformers,
      {
        create: operations.transformerCreate,
        update: operations.transformerUpdate,
      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: who added the transformer and when.
        defaults: (ctx) => ({ createdBy: ctx.context.principalId, createdAt: now(ctx) }),
        validate(record, ctx) {
          requireCustomer(ctx.state, record.customerId);
          assertUnique(store(ctx.state), record, 'serial', 'Transformer serial');
        },
      },
    ),
  ];
}
