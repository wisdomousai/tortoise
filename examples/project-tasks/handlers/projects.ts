import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { ProjectTaskState, Project } from '../domain';
import { projectRole } from '../policy';
import { dto, handler, page, project, put, type ProjectTaskServices } from '../server/context';

/** Projects and their membership; a membership change is an authorization change. */
export const projectHandlers = (): HandlerContribution<ProjectTaskState, ProjectTaskServices>[] => [
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
];
