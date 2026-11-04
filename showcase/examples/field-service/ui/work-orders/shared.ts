import { useParams } from '@tanstack/react-router';
import type { OutputOf } from '@tortoise/contracts';
import { operations } from '../../contracts';
import { client } from '@/lib/session';

export type Task = OutputOf<typeof operations.taskGet>;
export type Status = Task['status'];
export type WorkOrder = OutputOf<typeof operations.workOrderGet>;
/** Server page size for every work order and task list on these screens. */
export const PAGE = 50;
export const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Action failed';

/** The work order a screen shows, from the route; undefined on the work orders index. */
export const useWorkOrderId = () =>
  (useParams({ strict: false }) as { workOrderId?: string }).workOrderId;

/** The work order screen that shows a work order, or the work order a task belongs to. */
export const workOrderPath = (workOrderId: string) =>
  `/work-orders/${encodeURIComponent(workOrderId)}`;
export async function taskWorkOrderPath(taskId: string) {
  return workOrderPath((await client.query(operations.taskGet, { id: taskId })).data.workOrderId);
}
