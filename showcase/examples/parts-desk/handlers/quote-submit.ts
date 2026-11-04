import type { HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';
import { quoteIn, quoteRecords } from './quote';

/** Send a draft quote to the utility: the draft becomes submitted. */
export function quoteSubmitHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.quoteSubmit, (input, ctx) => {
      const quote = quoteIn(ctx, input.id, ['draft'], 'only a draft can be submitted');
      return quoteRecords(ctx).update(quote.id, { status: 'submitted' });
    }),
  ];
}
