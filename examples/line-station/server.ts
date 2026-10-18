import type { HandlerContribution } from '@agent-native/runtime';
import type { LineState } from './domain';
import { administrationHandlers } from './handlers/administration';
import { attentionHandlers } from './handlers/attention';
import { integrationHandlers } from './handlers/integration';
import { observationHandlers } from './handlers/observation';
import { productionHandlers } from './handlers/production';
import { approvalHandlers } from './handlers/approvals';
import { queryHandlers } from './handlers/queries';
import type { LineServices } from './server/context';

export type { LineServices } from './server/context';

/**
 * Domain handlers never touch the MES or the station screen. Requests to either are queued in
 * the outbox; observations and outcomes come back through integration commands.
 */
export function createLineHandlers(): HandlerContribution<LineState, LineServices>[] {
  return [
    ...queryHandlers(),
    ...productionHandlers(),
    ...attentionHandlers(),
    ...administrationHandlers(),
    ...observationHandlers(),
    ...integrationHandlers(),
    ...approvalHandlers(),
  ];
}
export { lineStationModule } from './contracts';
export { createLineState } from './domain';
export { linePolicy } from './policy';
