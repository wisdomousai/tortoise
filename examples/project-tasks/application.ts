import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import {
  assuranceAuthorizationRoute,
  createAssuranceHandlers,
  createAssuranceState,
  type AssuranceServices,
  type AssuranceState,
} from '@agent-native/assurance/server';
import manifest from './manifest';
import { operations } from './contracts';
import type { ProjectTaskState } from './domain';
import {
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
  type ProjectTaskServices,
} from './server';

/** Workspace state: one slice, so the module composes unchanged next to others. */
export interface ProjectTasksState {
  projectTasks: ProjectTaskState;
  /** Who may read the host's audit trail: the workspace owner. */
  assurance: AssuranceState;
}

/**
 * The project-tasks application the starter hosts. Workspaces written before modules were
 * composed hold project/task state at the root; upgrade moves it under `projectTasks` unchanged.
 * A workspace composed with other modules keeps only this slice.
 */
export function createProjectTasksApplication(options: { services?: ProjectTaskServices } = {}) {
  return defineApplication<ProjectTasksState, ProjectTaskServices & AssuranceServices>({
    manifest,
    createState: (ownerId) => ({
      projectTasks: createProjectTaskState(ownerId),
      assurance: createAssuranceState([ownerId]),
    }),
    upgradeState(state, ownerId) {
      const value = (state ?? {}) as Record<string, unknown>;
      const assurance =
        (value.assurance as AssuranceState | undefined) ?? createAssuranceState([ownerId]);
      if ('projects' in value)
        return { projectTasks: value as unknown as ProjectTaskState, assurance };
      return {
        projectTasks:
          (value.projectTasks as ProjectTaskState | undefined) ?? createProjectTaskState(ownerId),
        assurance,
      };
    },
    handlers: [
      ...sliceHandlers<ProjectTasksState, 'projectTasks', ProjectTaskServices & AssuranceServices>(
        'projectTasks',
        createProjectTaskHandlers(),
      ),
      ...sliceHandlers<ProjectTasksState, 'assurance', ProjectTaskServices & AssuranceServices>(
        'assurance',
        createAssuranceHandlers(),
      ),
    ],
    authorization: composeAuthorization<ProjectTasksState>([
      authorizationRoute(
        'projectTasks',
        projectTasksModule,
        ['project', 'task'],
        projectTaskPolicy,
      ),
      assuranceAuthorizationRoute<ProjectTasksState>((state) => state.assurance),
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { project: operations.projectGet.id, task: operations.taskGet.id },
  });
}

export default createProjectTasksApplication();
