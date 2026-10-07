import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { HandlerContribution, HandlerContext } from '@agent-native/runtime';
import { operations } from './contracts';
import type { Project, ProjectTaskState, Task } from './domain';
import { projectRole, visibleTasks } from './policy';

export interface ProjectTaskServices {
  newId?: () => string;
}
type Context = HandlerContext<ProjectTaskState, ProjectTaskServices>;
const project = (state: ProjectTaskState, id: string): Project =>
  Object.hasOwn(state.projects, id) ? state.projects[id]! : fail();
const task = (state: ProjectTaskState, id: string): Task =>
  Object.hasOwn(state.tasks, id) ? state.tasks[id]! : fail();
function put<T>(records: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(records, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
function fail(): never {
  throw new ApplicationError('NOT_FOUND', 'Resource unavailable');
}
function page<T>(items: T[], input: { offset?: number; limit?: number }) {
  return {
    count: items.length,
    items: items.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 50)),
  };
}
function dto<T extends Project | Task>(
  value: T,
  ctx: Context,
  changed = false,
): T & { revision: number } {
  return {
    ...value,
    revision:
      ctx.getRevision(`${'projectId' in value ? 'task' : 'project'}:${value.id}`) + Number(changed),
  };
}
function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<ProjectTaskState, ProjectTaskServices, C> {
  return { capability, handle };
}
/** Domain handlers never obtain independent database connections or transport identities. */
export function createProjectTaskHandlers(): HandlerContribution<
  ProjectTaskState,
  ProjectTaskServices
>[] {
  return [
    handler(operations.projectCreate, (input, ctx) => {
      const id = (ctx.services.newId ?? randomUUID)();
      if (Object.hasOwn(ctx.state.projects, id))
        throw new ApplicationError('CONFLICT', 'Identifier already exists');
      const value: Project = {
        id,
        name: input.name,
        archived: false,
        members: { [ctx.context.principalId]: 'owner' },
      };
      put(ctx.state.projects, id, value);
      ctx.change(`project:${id}`, 'authorization.changed');
      return dto(value, ctx, true);
    }),
    handler(operations.projectGet, (input, ctx) => dto(project(ctx.state, input.id), ctx)),
    handler(operations.projectList, (input, ctx) =>
      page(
        Object.values(ctx.state.projects)
          .filter(
            (value) =>
              projectRole(ctx.state, ctx.context.principalId, value.id) &&
              (!ctx.context.grant?.resources ||
                ctx.context.grant.resources.includes(`project:${value.id}`)) &&
              (input.archived === undefined || input.archived === value.archived),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((value) => dto(value, ctx)),
        input,
      ),
    ),
    handler(operations.projectArchive, (input, ctx) => {
      const value = project(ctx.state, input.id);
      value.archived = true;
      ctx.change(`project:${value.id}`);
      return dto(value, ctx, true);
    }),
    handler(operations.projectRestore, (input, ctx) => {
      const value = project(ctx.state, input.id);
      value.archived = false;
      ctx.change(`project:${value.id}`);
      return dto(value, ctx, true);
    }),
    handler(operations.projectSetMember, (input, ctx) => {
      const value = project(ctx.state, input.id);
      if (input.principalId === ctx.state.workspaceOwnerId)
        throw new ApplicationError('FORBIDDEN', 'Workspace owner membership is fixed');
      if (input.role === null) delete value.members[input.principalId];
      else
        Object.defineProperty(value.members, input.principalId, {
          value: input.role,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      ctx.change(`project:${value.id}`, 'authorization.changed');
      return dto(value, ctx, true);
    }),
    handler(operations.taskCreate, (input, ctx) => {
      project(ctx.state, input.projectId);
      const id = (ctx.services.newId ?? randomUUID)();
      if (Object.hasOwn(ctx.state.tasks, id) || Object.hasOwn(ctx.state.deletedTasks, id))
        throw new ApplicationError('CONFLICT', 'Identifier already exists');
      const value: Task = {
        id,
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? '',
        status: 'todo',
        ...(input.privateNote === undefined ? {} : { privateNote: input.privateNote }),
      };
      put(ctx.state.tasks, id, value);
      ctx.change(`task:${id}`);
      return dto(value, ctx, true);
    }),
    handler(operations.taskGet, (input, ctx) => dto(task(ctx.state, input.id), ctx)),
    handler(operations.taskList, (input, ctx) => {
      const items = visibleTasks(ctx.state, ctx.context.principalId).filter(
        (value) =>
          (!ctx.context.grant?.resources ||
            ctx.context.grant.resources.includes(`task:${value.id}`)) &&
          (!input.projectId || value.projectId === input.projectId) &&
          (!input.status || value.status === input.status) &&
          (!input.search ||
            `${value.title} ${value.description}`
              .toLowerCase()
              .includes(input.search.toLowerCase())),
      );
      const sort = input.sort ?? 'title';
      items.sort((a, b) => a[sort].localeCompare(b[sort]) || a.id.localeCompare(b.id));
      return page(
        items.map((value) => dto(value, ctx)),
        input,
      );
    }),
    handler(operations.taskUpdate, (input, ctx) => {
      const value = task(ctx.state, input.id);
      const { id, ...patch } = input;
      Object.assign(value, patch);
      ctx.change(`task:${id}`);
      return dto(value, ctx, true);
    }),
    handler(operations.taskSetStatus, (input, ctx) => {
      const value = task(ctx.state, input.id);
      value.status = input.status;
      ctx.change(`task:${value.id}`);
      return dto(value, ctx, true);
    }),
    handler(operations.taskDelete, (input, ctx) => {
      const value = task(ctx.state, input.id);
      put(ctx.state.deletedTasks, value.id, value.projectId);
      delete ctx.state.tasks[value.id];
      ctx.change(`task:${value.id}`);
      return { id: value.id };
    }),
  ];
}
export { projectTasksModule } from './contracts';
export { createProjectTaskState } from './domain';
export { projectTaskPolicy } from './policy';
