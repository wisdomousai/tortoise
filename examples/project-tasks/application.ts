import {
  approvalFeature,
  authorizationRoute,
  composeAuthorization,
  sliceHandlers,
  type ApprovalAccess,
  type ApprovalHooks,
} from '@agent-native/runtime';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { notificationsPlugin } from '@agent-native/notifications/plugin';
import { osPlugin } from '@agent-native/os/plugin';
import { osShortcutsPlugin } from '@agent-native/os-shortcuts/plugin';
import { shareTargetPlugin } from '@agent-native/share-target/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { webhookPlugin } from '@agent-native/webhook/plugin';
import manifest from './manifest';
import { operations } from './contracts';
import { migrations, storedSlice, type ProjectTaskState } from './domain';
import {
  approvalAccess,
  createProjectTaskHandlers,
  createProjectTaskState,
  projectTaskPolicy,
  projectTasksModule,
  type ProjectTaskServices,
} from './server';

/**
 * Workspace state: one slice, so the module composes unchanged next to others. Feature and plugin
 * slices (approval requests, the compliance auditors) are added by `defineApplication` under
 * their ids.
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
    migrations,
    upgradeState(state, ownerId) {
      const slice = (storedSlice(state) ?? createProjectTaskState(ownerId)) as ProjectTaskState;
      // Workspaces from before reminders get an empty map for them.
      return { projectTasks: { ...slice, reminderEffects: slice.reminderEffects ?? {} } };
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
    features: [
      mountFeature<ProjectTasksState, ApprovalAccess, ApprovalHooks, ProjectTaskServices>(
        approvalFeature(),
        {
          access: (state) => approvalAccess(state.projectTasks),
          hooks: {
            newId: (ctx) => (ctx.services.newId ?? (() => crypto.randomUUID()))(),
            now: (ctx) => (ctx.services.now ?? Date.now)(),
          },
          // Version 1 kept approval requests in the task slice, or at the root before modules
          // were composed.
          adopt: {
            before: 2,
            from: (stored) => ({ requests: storedSlice(stored)?.approvals ?? {} }),
          },
        },
      ),
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { project: operations.projectGet.id, task: operations.taskGet.id },
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      osPlugin,
      shareTargetPlugin,
      notificationsPlugin,
      osShortcutsPlugin,
      webhookPlugin,
    ],
  });
}

export default createProjectTasksApplication();
