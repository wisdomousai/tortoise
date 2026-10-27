import type { BlobRef } from '@agent-native/contracts';
import type { StateMigrations } from '@agent-native/runtime';

export type Role = 'dispatcher' | 'technician' | 'customer';
export interface WorkOrder {
  id: string;
  name: string;
  /** The customer site's address, where a technician does the work. */
  site?: string;
  closed: boolean;
  members: Record<string, Role>;
}
export interface Task {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done';
  internalNote?: string;
  /** A file attached when the task was created, held in the blob store. */
  attachment?: BlobRef;
  /** The last reminder: queued until a desktop or phone shows it, then shown or refused. */
  reminder?: 'pending' | 'accepted' | 'rejected';
}
export interface ServiceState {
  workspaceOwnerId: string;
  workOrders: Record<string, WorkOrder>;
  tasks: Record<string, Task>;
  deletedTasks: Record<string, string>;
  /** The task each queued reminder effect is about, until it completes. */
  reminderEffects: Record<string, string>;
}
export function createServiceState(ownerId = 'owner'): ServiceState {
  return {
    workspaceOwnerId: ownerId,
    workOrders: {},
    tasks: {},
    deletedTasks: {},
    reminderEffects: {},
  };
}

/** The task slice of a stored workspace: under `fieldService`, or at the root before composition. */
export function storedSlice(stored: unknown): Record<string, unknown> | undefined {
  const value = (stored ?? {}) as Record<string, unknown>;
  return ('workOrders' in value ? value : value.fieldService) as
    Record<string, unknown> | undefined;
}

/**
 * Version 2 moved approval requests from the task slice into the `approval` feature's slice,
 * which adopts them first (`application.ts`). The step is not compatible, so code from version 1
 * refuses a version 2 workspace instead of running without its approval requests.
 */
export const migrations: StateMigrations = {
  version: 2,
  steps: [
    {
      from: 1,
      to: 2,
      up: (stored) => {
        const value = structuredClone(stored ?? {});
        const slice = storedSlice(value);
        if (slice) delete slice.approvals;
        return value;
      },
    },
  ],
};
