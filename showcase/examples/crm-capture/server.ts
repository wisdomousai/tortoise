import type { HandlerContribution } from '@agent-native/runtime';
import type { CrmState } from './domain';
import { accountHandlers } from './handlers/accounts';
import { captureHandlers } from './handlers/capture';
import type { CrmServices } from './handlers/context';
import { integrationHandlers } from './handlers/integration';
import { providerHandlers } from './handlers/providers';

export type { CrmServices } from './handlers/context';

/**
 * Every handler. The provider handlers never call the CRM: the runtime calls the source between
 * their pure steps. Forwarding is queued and settled through commands.
 */
export function createCrmHandlers(): HandlerContribution<CrmState, CrmServices>[] {
  return [
    ...providerHandlers(),
    ...accountHandlers(),
    ...captureHandlers(),
    ...integrationHandlers(),
  ];
}
export { crmCaptureModule } from './contracts';
export { createCrmState } from './domain';
export { crmPolicy } from './policy';
