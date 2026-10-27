import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { HandlerContribution, HandlerContext } from '@agent-native/runtime';
import type { WorkOrder, ServiceState, Task } from '../domain';

/** Injected services; tests pass a deterministic `newId` and clock. */
export interface WorkOrderServices {
  newId?: () => string;
  /** Clock for approval request expiry. */
  now?: () => number;
}
/** What every handler receives: the transaction's state, trusted context and services. */
export type Context = HandlerContext<ServiceState, WorkOrderServices>;
export const workOrder = (state: ServiceState, id: string): WorkOrder =>
  Object.hasOwn(state.workOrders, id) ? state.workOrders[id]! : fail();
export const task = (state: ServiceState, id: string): Task =>
  Object.hasOwn(state.tasks, id) ? state.tasks[id]! : fail();
export function put<T>(records: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(records, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export function fail(): never {
  throw new ApplicationError('NOT_FOUND', 'Resource unavailable');
}
export function page<T>(items: T[], input: { offset?: number; limit?: number }) {
  return {
    count: items.length,
    items: items.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 50)),
  };
}
export function dto<T extends WorkOrder | Task>(
  value: T,
  ctx: Context,
  changed = false,
): T & { revision: number } {
  return {
    ...value,
    revision:
      ctx.getRevision(`${'workOrderId' in value ? 'task' : 'work-order'}:${value.id}`) +
      Number(changed),
  };
}
export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<ServiceState, WorkOrderServices, C> {
  return { capability, handle };
}
