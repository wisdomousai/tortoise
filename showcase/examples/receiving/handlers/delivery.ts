import { ApplicationError } from '@agent-native/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { deliveries, type Delivery } from '../contracts/delivery';
import { discrepant, type AppState } from '../domain';
import { handler, type Context, type Services } from './context';

type List = typeof operations.deliveryList;
type Get = typeof operations.deliveryGet;
/** Every member sees every delivery; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.deliveries;
const deliveriesOf = (ctx: Context) => records(ctx, deliveries, ctx.state.deliveries);

/** A line that can still change: not posted. */
function open(ctx: Context, id: string): Delivery {
  const delivery = deliveriesOf(ctx).getExisting(id);
  if (delivery.status === 'posted')
    throw new ApplicationError('CONFLICT', 'The goods receipt for this line is already posted');
  return delivery;
}

/** Generated reads, scoped before filters and counts, and counting and classifying a line. */
export function deliveryHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Delivery>(deliveries, operations.deliveryList, {
      store,
      visible,
      order: (a, b) => b.arrivedAt - a.arrivedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) =>
        [record.purchaseOrder, record.supplier, record.sku, record.description].join(' '),
    }),
    collectionGetHandler<AppState, Services, Get, Delivery>(deliveries, operations.deliveryGet, {
      store,
      visible,
    }),
    handler(operations.deliveryReceive, (input, ctx) => {
      open(ctx, input.id);
      return deliveriesOf(ctx).update(input.id, (delivery) => {
        delivery.counted = input.counted;
        delivery.status = 'counted';
        // A matching count has nothing to explain.
        if (!discrepant(delivery)) {
          delete delivery.reason;
          delete delivery.note;
        }
      });
    }),
    handler(operations.deliveryClassify, (input, ctx) => {
      const delivery = open(ctx, input.id);
      if (!discrepant(delivery))
        throw new ApplicationError('CONFLICT', 'The counted quantity matches the notice');
      return deliveriesOf(ctx).update(input.id, (record) => {
        record.reason = input.reason;
        if (input.note) record.note = input.note;
        else delete record.note;
      });
    }),
  ];
}
