import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { totalOf } from '../contracts/quote';
import type { AppState } from '../domain';
import { handler, type Services } from './context';
import { quoteIn, quoteRecords } from './quote';

/**
 * Set the discount of a draft quote. The policy decides who may set more than 10 percent before
 * this runs; the handler checks only that the quote is a draft.
 */
export function quoteDiscountHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.quoteDiscount, (input, ctx) => {
      const quote = quoteIn(ctx, input.id, ['draft'], 'only a draft takes a discount');
      return quoteRecords(ctx).update(quote.id, {
        discountPercent: input.percent,
        discountReason: input.reason,
        total: totalOf(quote.lines, input.percent),
      });
    }),
  ];
}
