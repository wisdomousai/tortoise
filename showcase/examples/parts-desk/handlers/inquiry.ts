import { ApplicationError } from '@tortoise/contracts';
import {
  collectionCommandHandlers,
  collectionGetHandler,
  collectionListHandler,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { inquiries, type Inquiry } from '../contracts/inquiry';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';
import { requireCustomer, transformerBySerial } from './transformer';

type List = typeof operations.inquiryList;
type Get = typeof operations.inquiryGet;
/** Every member sees every inquiry; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.inquiries;

/** Generated reads, scoped before filters and counts, and the generated commands. */
export function inquiryHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Inquiry>(inquiries, operations.inquiryList, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) =>
        `${record.subject} ${record.caller} ${record.transformerSerial ?? ''}`,
    }),
    collectionGetHandler<AppState, Services, Get, Inquiry>(inquiries, operations.inquiryGet, {
      store,
      visible,
    }),
    ...collectionCommandHandlers<AppState, Services, Inquiry>(
      inquiries,
      {
        create: operations.inquiryCreate,
        update: operations.inquiryUpdate,
      },
      {
        store,
        newKey: newId,
        // The fields a person does not choose: a new inquiry is open and records who made it.
        defaults: (ctx) => ({
          status: 'open',
          createdBy: ctx.context.principalId,
          createdAt: now(ctx),
        }),
        // Checked on every write, so an update that changes the utility or the serial cannot
        // leave an inquiry about another utility's transformer.
        validate(record, ctx) {
          requireCustomer(ctx.state, record.customerId);
          if (record.transformerSerial === undefined) return;
          const transformer = transformerBySerial(ctx.state, record.transformerSerial);
          if (!transformer)
            throw new ApplicationError('NOT_FOUND', 'Transformer unavailable', {
              field: 'transformerSerial',
            });
          if (transformer.customerId !== record.customerId)
            throw new ApplicationError(
              'INVALID_INPUT',
              `${transformer.serial} is not a transformer of this utility`,
              { field: 'transformerSerial' },
            );
        },
      },
    ),
  ];
}
