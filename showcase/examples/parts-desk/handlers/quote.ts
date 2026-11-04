import { ApplicationError } from '@tortoise/contracts';
import {
  collectionGetHandler,
  collectionListHandler,
  own,
  records,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import type { Transformer } from '../contracts/transformer';
import { quotes, totalOf, type Quote, type QuoteLine } from '../contracts/quote';
import type { AppState } from '../domain';
import { compact, handler, newId, now, type Context, type Services } from './context';
import { requireCustomer, transformerBySerial } from './transformer';

type List = typeof operations.quoteList;
type Get = typeof operations.quoteGet;
/** Every member sees every quote; the policy's caller gate keeps everyone else out. */
const visible = () => true;
const store = (state: AppState) => state.quotes;

/** One collection's records in this transaction; every write declares `quote:<id>`. */
export const quoteRecords = (ctx: Context) => records(ctx, quotes, ctx.state.quotes);

/**
 * The quote, if its status is one of `statuses`. A missing quote is NOT_FOUND and any other
 * status CONFLICT, so a command never moves a quote along a change of status it does not own.
 */
export function quoteIn(
  ctx: Context,
  id: string,
  statuses: readonly Quote['status'][],
  action: string,
): Quote {
  const quote = quoteRecords(ctx).getExisting(id);
  if (!statuses.includes(quote.status))
    throw new ApplicationError('CONFLICT', `Quote ${quote.number} is ${quote.status}; ${action}`, {
      status: quote.status,
    });
  return quote;
}

/**
 * The next number, one above the highest in use. No command removes a quote, and commands run
 * one at a time, so numbers are unique and run in the order the quotes were created.
 */
function nextNumber(state: AppState): string {
  const last = Object.values(state.quotes).reduce(
    (highest, quote) => Math.max(highest, Number(quote.number.slice(2))),
    0,
  );
  if (last >= 99_999) throw new ApplicationError('CONFLICT', 'Every quote number is in use');
  return `Q-${String(last + 1).padStart(5, '0')}`;
}

/** The utility's transformer with this serial: NOT_FOUND when unknown, INVALID_INPUT when another's. */
function customerTransformer(state: AppState, customerId: string, serial: string): Transformer {
  const transformer = transformerBySerial(state, serial);
  if (!transformer)
    throw new ApplicationError('NOT_FOUND', 'Transformer unavailable', {
      field: 'transformerSerial',
    });
  if (transformer.customerId !== customerId)
    throw new ApplicationError(
      'INVALID_INPUT',
      `${transformer.serial} is not a transformer of this utility`,
      { field: 'transformerSerial' },
    );
  return transformer;
}

/**
 * The stored lines: each part looked up by number, refused unless it fits the transformer's
 * model, with its description and current unit price copied onto the line.
 */
function linesFor(
  state: AppState,
  transformer: Transformer,
  lines: readonly { partNumber: string; quantity: number }[],
): QuoteLine[] {
  const parts = Object.values(state.parts);
  return lines.map(({ partNumber, quantity }) => {
    const part = parts.find((candidate) => candidate.partNumber === partNumber);
    if (!part)
      throw new ApplicationError('NOT_FOUND', `Part ${partNumber} unavailable`, { field: 'lines' });
    if (!part.fits.includes(transformer.model))
      throw new ApplicationError(
        'INVALID_INPUT',
        `${partNumber} does not fit ${transformer.serial}, a ${transformer.model}`,
        { field: 'lines' },
      );
    return { partNumber, description: part.description, quantity, unitPrice: part.unitPrice };
  });
}

/** Generated reads, scoped before filters and counts, and the commands that write the lines. */
export function quoteHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, List, Quote>(quotes, operations.quoteList, {
      store,
      visible,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      searchText: (record) => `${record.number} ${record.transformerSerial}`,
    }),
    collectionGetHandler<AppState, Services, Get, Quote>(quotes, operations.quoteGet, {
      store,
      visible,
    }),
    handler(operations.quoteCreate, async (input, ctx) => {
      requireCustomer(ctx.state, input.customerId);
      const transformer = customerTransformer(ctx.state, input.customerId, input.transformerSerial);
      const lines = linesFor(ctx.state, transformer, input.lines);
      if (input.inquiryId !== undefined) {
        const inquiry = own(ctx.state.inquiries, input.inquiryId);
        if (!inquiry)
          throw new ApplicationError('NOT_FOUND', 'Inquiry unavailable', { field: 'inquiryId' });
        if (inquiry.customerId !== input.customerId)
          throw new ApplicationError('INVALID_INPUT', 'The inquiry is from another utility', {
            field: 'inquiryId',
          });
      }
      const quote: Quote = compact({
        id: newId(ctx),
        number: nextNumber(ctx.state),
        customerId: input.customerId,
        transformerSerial: transformer.serial,
        inquiryId: input.inquiryId,
        lines,
        discountPercent: 0,
        status: 'draft' as const,
        total: totalOf(lines, 0),
        createdBy: ctx.context.principalId,
        createdAt: now(ctx),
      });
      quoteRecords(ctx).insert(quote.id, quote);
      // inquiry.update runs in this transaction under the caller's policy, so the quote and the
      // quoted inquiry commit together or not at all.
      if (input.inquiryId !== undefined)
        await ctx.invoke(operations.inquiryUpdate, { id: input.inquiryId, status: 'quoted' });
      return quote;
    }),
    handler(operations.quoteUpdate, (input, ctx) => {
      const quote = quoteIn(ctx, input.id, ['draft'], 'only a draft takes new lines');
      const transformer = customerTransformer(ctx.state, quote.customerId, quote.transformerSerial);
      const lines = linesFor(ctx.state, transformer, input.lines);
      return quoteRecords(ctx).update(quote.id, {
        lines,
        total: totalOf(lines, quote.discountPercent),
      });
    }),
  ];
}
