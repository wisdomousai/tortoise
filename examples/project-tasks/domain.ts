import type { Proposal } from '@agent-native/contracts';

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
}
export interface ProjectTaskState {
  workspaceOwnerId: string;
  projects: Record<string, Project>;
  tasks: Record<string, Task>;
  deletedTasks: Record<string, string>;
  /** Proposed task commands, usually from the planner, keyed by ID. */
  proposals: Record<string, Proposal>;
}
export function createProjectTaskState(ownerId = 'owner'): ProjectTaskState {
  return { workspaceOwnerId: ownerId, projects: {}, tasks: {}, deletedTasks: {}, proposals: {} };
}
