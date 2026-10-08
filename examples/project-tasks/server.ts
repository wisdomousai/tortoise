import type { HandlerContribution } from '@agent-native/runtime';
import type { ProjectTaskState } from './domain';
import { projectHandlers } from './handlers/projects';
import { taskHandlers } from './handlers/tasks';
import type { ProjectTaskServices } from './server/context';

export type { ProjectTaskServices } from './server/context';

/** Domain handlers never obtain independent database connections or transport identities. */
export function createProjectTaskHandlers(): HandlerContribution<
  ProjectTaskState,
  ProjectTaskServices
>[] {
  return [...projectHandlers(), ...taskHandlers()];
}
export { projectTasksModule } from './contracts';
export { createProjectTaskState } from './domain';
export { projectTaskPolicy } from './policy';
