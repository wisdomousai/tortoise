import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { assurancePlugin } from '@agent-native/assurance/plugin';
import { securityPlugin } from '@agent-native/security/plugin';
import { webhookPlugin } from '@agent-native/webhook/plugin';
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

/**
 * Workspace state: one slice, so the module composes unchanged next to others. Plugin slices
 * (the assurance auditors) are added by `defineApplication` under their plugin ids.
 */
export interface ProjectTasksState {
  projectTasks: ProjectTaskState;
}

/**
 * The project-tasks application the starter hosts. Workspaces written before modules were
 * composed hold project/task state at the root; upgrade moves it under `projectTasks` unchanged.
 * A workspace composed with other modules keeps only this slice.
 */
export function createProjectTasksApplication(options: { services?: ProjectTaskServices } = {}) {
  return defineApplication<ProjectTasksState, ProjectTaskServices>({
    manifest,
    createState: (ownerId) => ({ projectTasks: createProjectTaskState(ownerId) }),
    upgradeState(state, ownerId) {
      const value = (state ?? {}) as Record<string, unknown>;
      if ('projects' in value) return { projectTasks: value as unknown as ProjectTaskState };
      return {
        projectTasks:
          (value.projectTasks as ProjectTaskState | undefined) ?? createProjectTaskState(ownerId),
      };
    },
    handlers: sliceHandlers<ProjectTasksState, 'projectTasks', ProjectTaskServices>(
      'projectTasks',
      createProjectTaskHandlers(),
    ),
    authorization: composeAuthorization<ProjectTasksState>([
      authorizationRoute(
        'projectTasks',
        projectTasksModule,
        ['project', 'task'],
        projectTaskPolicy,
      ),
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { project: operations.projectGet.id, task: operations.taskGet.id },
    plugins: [securityPlugin, assurancePlugin, webhookPlugin],
  });
}

export default createProjectTasksApplication();
