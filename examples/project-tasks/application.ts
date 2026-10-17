import { authorizationRoute, composeAuthorization, sliceHandlers } from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
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
 * (the compliance auditors) are added by `defineApplication` under their plugin ids.
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
      const slice = (
        'projects' in value ? value : (value.projectTasks ?? createProjectTaskState(ownerId))
      ) as ProjectTaskState;
      // Workspaces from before proposals get an empty proposal slice.
      return { projectTasks: { ...slice, proposals: slice.proposals ?? {} } };
    },
    handlers: sliceHandlers<ProjectTasksState, 'projectTasks', ProjectTaskServices>(
      'projectTasks',
      createProjectTaskHandlers(),
    ),
    authorization: composeAuthorization<ProjectTasksState>([
      authorizationRoute(
        'projectTasks',
        projectTasksModule,
        ['project', 'task', 'proposal'],
        projectTaskPolicy,
      ),
    ]),
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { project: operations.projectGet.id, task: operations.taskGet.id },
    plugins: [sitePlugin, networkPlugin, auditPlugin, compliancePlugin, webhookPlugin],
  });
}

export default createProjectTasksApplication();
