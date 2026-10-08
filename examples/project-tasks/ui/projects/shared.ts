import { useParams } from '@tanstack/react-router';
import type { OutputOf } from '@agent-native/contracts';
import type { operations } from '../../contracts';

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
