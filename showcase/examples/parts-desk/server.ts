import type { HandlerContribution } from '@agent-native/runtime';
import type { AppState } from './domain';
import type { Services } from './handlers/context';
import { inquiryHandlers } from './handlers/inquiry';
import { customerHandlers } from './handlers/customer';
import { transformerHandlers } from './handlers/transformer';
import { partHandlers } from './handlers/part';
import { transformerFindHandlers } from './handlers/transformer-find';
import { partSearchHandlers } from './handlers/part-search';
import { quoteHandlers } from './handlers/quote';
import { quoteDiscountHandlers } from './handlers/quote-discount';
import { quoteSubmitHandlers } from './handlers/quote-submit';
import { quoteCancelHandlers } from './handlers/quote-cancel';
import { memberCurrentHandlers } from './handlers/member-current';
// scaffold:imports

export type { Services } from './handlers/context';
export { appPolicy } from './policy';

/** Every handler of the application: one group per collection, capability and target. */
export function createHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    ...inquiryHandlers(),
    ...customerHandlers(),
    ...transformerHandlers(),
    ...partHandlers(),
    ...transformerFindHandlers(),
    ...partSearchHandlers(),
    ...quoteHandlers(),
    ...quoteDiscountHandlers(),
    ...quoteSubmitHandlers(),
    ...quoteCancelHandlers(),
    ...memberCurrentHandlers(),
    // scaffold:handlers
  ];
}
