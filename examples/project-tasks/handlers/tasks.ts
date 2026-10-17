import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { ProjectTaskState, Task } from '../domain';
import { visibleTasks } from '../policy';
import {
  dto,
  handler,
  page,
  project,
  put,
  task,
  type ProjectTaskServices,
} from '../server/context';

/** Tasks within visible projects; reads are scoped before filtering, sorting and paging. */
export const taskHandlers = (): HandlerContribution<ProjectTaskState, ProjectTaskServices>[] => [
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
      ...(input.attachment === undefined ? {} : { attachment: input.attachment }),
    };
    put(ctx.state.tasks, id, value);
    ctx.change(`task:${id}`);
    // The runtime accepts the reference only within the declared limits and only if this caller
    // uploaded it recently or may already read it; it commits with the task or not at all.
    if (input.attachment) ctx.attach(`task:${id}`, input.attachment);
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
          `${value.title} ${value.description}`.toLowerCase().includes(input.search.toLowerCase())),
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
    // Without a reference the blob store sweeps the bytes after its grace period.
    if (value.attachment) ctx.detach(`task:${value.id}`, value.attachment.digest);
    return { id: value.id };
  }),
];
