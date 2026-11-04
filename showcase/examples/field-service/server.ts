import type { HandlerContribution } from '@tortoise/runtime';
import type { ServiceState } from './domain';
import { workOrderHandlers } from './handlers/work-orders';
import { taskHandlers } from './handlers/tasks';
import type { WorkOrderServices } from './server/context';

export type { WorkOrderServices } from './server/context';

/** Domain handlers never obtain independent database connections or transport identities. */
export function createServiceHandlers(): HandlerContribution<ServiceState, WorkOrderServices>[] {
  return [...workOrderHandlers(), ...taskHandlers()];
}
export { workOrderPlannerModule, fieldServiceModule } from './contracts';
export { createServiceState } from './domain';
export { approvalAccess, servicePolicy } from './policy';
