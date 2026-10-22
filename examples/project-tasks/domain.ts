import type { BlobRef } from '@agent-native/contracts';
import type { StateMigrations } from '@agent-native/runtime';

export type Role = 'owner' | 'editor' | 'viewer';
export interface Project {
  id: string;
  name: string;
  archived: boolean;
  members: Record<string, Role>;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done';
  privateNote?: string;
  /** A file attached when the task was created, held in the blob store. */
  attachment?: BlobRef;
  /** The last reminder: queued until a desktop or phone shows it, then shown or refused. */
  reminder?: 'pending' | 'accepted' | 'rejected';
}
export interface ProjectTaskState {
  workspaceOwnerId: string;
  projects: Record<string, Project>;
  tasks: Record<string, Task>;
  deletedTasks: Record<string, string>;
  /** The task each queued reminder effect is about, until it settles. */
  reminderEffects: Record<string, string>;
}
export function createProjectTaskState(ownerId = 'owner'): ProjectTaskState {
  return {
    workspaceOwnerId: ownerId,
    projects: {},
    tasks: {},
    deletedTasks: {},
    reminderEffects: {},
  };
}

/** The task slice of a stored workspace: under `projectTasks`, or at the root before composition. */
export function storedSlice(stored: unknown): Record<string, unknown> | undefined {
  const value = (stored ?? {}) as Record<string, unknown>;
  return ('projects' in value ? value : value.projectTasks) as Record<string, unknown> | undefined;
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
