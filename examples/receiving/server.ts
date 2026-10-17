import type { HandlerContribution } from '@agent-native/runtime';
import type { AppState } from './domain';
import type { Services } from './handlers/context';
import { deliveryHandlers } from './handlers/delivery';
import { erpHandlers } from './handlers/erp-target';
import { proposalHandlers } from './handlers/proposals';
// scaffold:imports

export type { Services } from './handlers/context';
export { appPolicy } from './policy';

/** Every handler of the application: one group per collection, capability and target. */
export function createHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    ...deliveryHandlers(),
    ...erpHandlers(),
    ...(proposalHandlers() as HandlerContribution<AppState, Services>[]),
    // scaffold:handlers
  ];
}
