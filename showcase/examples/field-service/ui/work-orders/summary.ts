import type { Task, WorkOrder } from './shared';

/** The text a work order's summary shares: its name, its site and the tasks not yet done. */
export function workOrderSummary(workOrder: WorkOrder, tasks: readonly Task[]) {
  const open = tasks.filter((task) => task.status !== 'done');
  return [
    workOrder.name,
    ...(workOrder.site ? [`Site: ${workOrder.site}`] : []),
    open.length ? 'Open tasks:' : 'No open tasks',
    ...open.map((task) => `- ${task.title}${task.status === 'doing' ? ' (in progress)' : ''}`),
  ].join('\n');
}
