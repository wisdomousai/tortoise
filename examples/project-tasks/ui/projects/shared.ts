import { useParams } from '@tanstack/react-router';
import type { OutputOf } from '@agent-native/contracts';
import { operations } from '../../contracts';
import { client } from '@/lib/session';

export type Task = OutputOf<typeof operations.taskGet>;
export type Status = Task['status'];
export type Project = OutputOf<typeof operations.projectGet>;
/** Server page size for every project and task list on these screens. */
export const PAGE = 50;
export const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Action failed';

/** The project a screen shows, from the route; undefined on the projects index. */
export const useProjectId = () =>
  (useParams({ strict: false }) as { projectId?: string }).projectId;

/** The project screen that shows a project, or the project a task belongs to. */
export const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
export async function taskProjectPath(taskId: string) {
  return projectPath((await client.query(operations.taskGet, { id: taskId })).data.projectId);
}
