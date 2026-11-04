import { ApplicationError } from '@tortoise/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { inspectionRequests, type InspectionRequest } from '../contracts/inspection-requests';
import { capturesAnywhere, type QualityState } from '../domain';
import { byCodePoint, compact, newId, now, handler, type QualityServices } from '../server/context';

/** Closed requests inbound sync returns in one page. */
const OUTCOMES_PAGE = 100;

/**
 * Inspection requests: a peer creates them as its service principal, an inspector closes them, and the
 * peer reads the outcomes of its own from inbound sync.
 */
export const inspectionRequestHandlers = (): HandlerContribution<
  QualityState,
  QualityServices
>[] => [
  collectionListHandler<
    QualityState,
    QualityServices,
    typeof operations.inspectionRequestList,
    InspectionRequest
  >(inspectionRequests, operations.inspectionRequestList, {
    store: (state) => state.inspectionRequests,
    // Inspection requests belong to no plant yet: everyone who captures somewhere sees them.
    visible: (_request, ctx) => capturesAnywhere(ctx.state, ctx.context.principalId),
    order: (a, b) =>
      Number(a.status !== 'open') - Number(b.status !== 'open') ||
      b.requestedAt - a.requestedAt ||
      byCodePoint(a.id, b.id),
    searchText: (request) =>
      [request.purchaseOrder, request.supplier, request.sku, request.description].join(' '),
  }),
  collectionGetHandler<
    QualityState,
    QualityServices,
    typeof operations.inspectionRequestGet,
    InspectionRequest
  >(inspectionRequests, operations.inspectionRequestGet, {
    store: (state) => state.inspectionRequests,
    visible: (_request, ctx) => capturesAnywhere(ctx.state, ctx.context.principalId),
  }),
  handler(operations.inspectionRequestCreate, (input, ctx) => {
    const requestedBy = ctx.context.principalId;
    // A delivery sent again while its request is open, such as after its goods receipt was
    // posted a second time, gets the open request.
    const open = Object.values(ctx.state.inspectionRequests).find(
      (request) =>
        request.requestedBy === requestedBy &&
        request.delivery === input.delivery &&
        request.status === 'open',
    );
    if (open) return { id: open.id };
    const id = newId(ctx);
    records(ctx, inspectionRequests, ctx.state.inspectionRequests).insert(id, {
      id,
      ...input,
      requestedBy,
      status: 'open',
      requestedAt: now(ctx),
    });
    return { id };
  }),
  handler(operations.inspectionRequestClose, (input, ctx) => {
    const store = records(ctx, inspectionRequests, ctx.state.inspectionRequests);
    if (store.getExisting(input.id).status !== 'open')
      throw new ApplicationError('CONFLICT', 'The inspection request is already closed');
    const seq = ++ctx.state.requestSequence;
    return store.update(input.id, (request) => {
      Object.assign(
        request,
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
  handler(operations.inspectionRequestOutcomes, (input, ctx) => {
    const after = input.cursor === undefined ? 0 : Number(input.cursor);
    if (!Number.isInteger(after) || after < 0)
      throw new ApplicationError('INVALID_INPUT', 'Unknown inbound cursor', { field: 'cursor' });
    // Only the calling peer's requests, so one peer never learns of another's deliveries.
    const closed = Object.values(ctx.state.inspectionRequests)
      .filter(
        (request) => request.requestedBy === ctx.context.principalId && (request.seq ?? 0) > after,
      )
      .sort((a, b) => a.seq! - b.seq!);
    const page = closed.slice(0, OUTCOMES_PAGE);
    return {
      items: page.map((request) =>
        compact({
          id: request.id,
          delivery: request.delivery,
          outcome: request.outcome!,
          note: request.note,
          closedAt: request.closedAt!,
        }),
      ),
      cursor: String(page.at(-1)?.seq ?? after),
      ...(closed.length > page.length ? { more: true } : {}),
    };
  }),
];
