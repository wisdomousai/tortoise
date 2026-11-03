import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';
import { quoteIn, quoteRecords } from './quote';

/** Cancel a draft or submitted quote and keep the reason. A cancelled quote stays cancelled. */
export function quoteCancelHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.quoteCancel, (input, ctx) => {
      const quote = quoteIn(ctx, input.id, ['draft', 'submitted'], 'it cannot be cancelled again');
      return quoteRecords(ctx).update(quote.id, {
        status: 'cancelled',
        cancelReason: input.reason,
      });
    }),
  ];
}
