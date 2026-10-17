import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type { HandlerContribution, HandlerContext } from '@agent-native/runtime';
import type { Project, ProjectTaskState, Task } from '../domain';

/** Injected services; tests pass a deterministic `newId` and clock. */
export interface ProjectTaskServices {
  newId?: () => string;
  /** Clock for proposal expiry. */
  now?: () => number;
}
/** What every handler receives: the transaction's state, trusted context and services. */
export type Context = HandlerContext<ProjectTaskState, ProjectTaskServices>;
export const project = (state: ProjectTaskState, id: string): Project =>
  Object.hasOwn(state.projects, id) ? state.projects[id]! : fail();
export const task = (state: ProjectTaskState, id: string): Task =>
  Object.hasOwn(state.tasks, id) ? state.tasks[id]! : fail();
export function put<T>(records: Record<string, T>, id: string, value: T): void {
  Object.defineProperty(records, id, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export function fail(): never {
  throw new ApplicationError('NOT_FOUND', 'Resource unavailable');
}
export function page<T>(items: T[], input: { offset?: number; limit?: number }) {
  return {
    count: items.length,
    items: items.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 50)),
  };
}
export function dto<T extends Project | Task>(
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
export function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<ProjectTaskState, ProjectTaskServices, C> {
  return { capability, handle };
}
