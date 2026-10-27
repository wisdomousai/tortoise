import { ApplicationError } from '@agent-native/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@agent-native/runtime';
import { operations } from '../contracts';
import { arrivals, type Arrival } from '../contracts/arrivals';
import { capturesAnywhere, type QualityState } from '../domain';
import { byCodePoint, compact, newId, now, handler, type QualityServices } from '../server/context';

/** Arrivals the feed answers in one page. */
const FEED_PAGE = 100;

/**
 * Arrivals: a peer announces them as its service principal, an inspector closes them, and the
 * peer reads the outcomes of its own from the feed.
 */
export const arrivalHandlers = (): HandlerContribution<QualityState, QualityServices>[] => [
  collectionListHandler<QualityState, QualityServices, typeof operations.arrivalList, Arrival>(
    arrivals,
    operations.arrivalList,
    {
      store: (state) => state.arrivals,
      // Arrivals belong to no plant yet: everyone who captures somewhere sees them.
      visible: (_arrival, ctx) => capturesAnywhere(ctx.state, ctx.context.principalId),
      order: (a, b) =>
        Number(a.status !== 'open') - Number(b.status !== 'open') ||
        b.announcedAt - a.announcedAt ||
        byCodePoint(a.id, b.id),
      searchText: (arrival) =>
        [arrival.purchaseOrder, arrival.supplier, arrival.sku, arrival.description].join(' '),
    },
  ),
  collectionGetHandler<QualityState, QualityServices, typeof operations.arrivalGet, Arrival>(
    arrivals,
    operations.arrivalGet,
    {
      store: (state) => state.arrivals,
      visible: (_arrival, ctx) => capturesAnywhere(ctx.state, ctx.context.principalId),
    },
  ),
  handler(operations.arrivalAnnounce, (input, ctx) => {
    const from = ctx.context.principalId;
    // A delivery announced again while its arrival is open, such as after its goods receipt was
    // posted a second time, gets the open arrival.
    const open = Object.values(ctx.state.arrivals).find(
      (arrival) =>
        arrival.from === from && arrival.delivery === input.delivery && arrival.status === 'open',
    );
    if (open) return { id: open.id };
    const id = newId(ctx);
    records(ctx, arrivals, ctx.state.arrivals).insert(id, {
      id,
      ...input,
      from,
      status: 'open',
      announcedAt: now(ctx),
    });
    return { id };
  }),
  handler(operations.arrivalClose, (input, ctx) => {
    const store = records(ctx, arrivals, ctx.state.arrivals);
    if (store.getExisting(input.id).status !== 'open')
      throw new ApplicationError('CONFLICT', 'The arrival is already closed');
    const seq = ++ctx.state.arrivalSequence;
    return store.update(input.id, (arrival) => {
      Object.assign(
        arrival,
        compact({
          status: 'closed' as const,
          outcome: input.outcome,
          note: input.note,
          closedAt: now(ctx),
          closedBy: ctx.context.principalId,
          seq,
        }),
      );
    });
  }),
  handler(operations.arrivalFeed, (input, ctx) => {
    const after = input.cursor === undefined ? 0 : Number(input.cursor);
    if (!Number.isInteger(after) || after < 0)
      throw new ApplicationError('INVALID_INPUT', 'Unknown feed cursor', { field: 'cursor' });
    // Only the calling peer's arrivals, so one peer never learns of another's deliveries.
    const closed = Object.values(ctx.state.arrivals)
      .filter((arrival) => arrival.from === ctx.context.principalId && (arrival.seq ?? 0) > after)
      .sort((a, b) => a.seq! - b.seq!);
    const page = closed.slice(0, FEED_PAGE);
    return {
      items: page.map((arrival) =>
        compact({
          id: arrival.id,
          delivery: arrival.delivery,
          outcome: arrival.outcome!,
          note: arrival.note,
          closedAt: arrival.closedAt!,
        }),
      ),
      cursor: String(page.at(-1)?.seq ?? after),
      ...(closed.length > page.length ? { more: true } : {}),
    };
  }),
];
