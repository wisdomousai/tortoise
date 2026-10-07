import type { AuthorizationPort, ExecutionContext } from '@agent-native/runtime';
import type { Project, ProjectTaskState, Role, Task } from './domain';
import { createScopedAbility, matchesScope } from '../../packages/adapters/src/casl';
import { operations } from './contracts';

const knownOperations = new Set<string>(Object.values(operations).map((operation) => operation.id));

export function projectRole(
  state: ProjectTaskState,
  principal: string,
  projectId: string,
): Role | undefined {
  const project = Object.hasOwn(state.projects, projectId) ? state.projects[projectId] : undefined;
  if (!project) return undefined;
  return state.workspaceOwnerId === principal
    ? 'owner'
    : Object.hasOwn(project.members, principal)
      ? project.members[principal]
      : undefined;
}
export function taskReadScope(state: ProjectTaskState, principal: string) {
  return domainAbility(state, principal).scopeFor('read', 'Task');
}
function domainAbility(state: ProjectTaskState, principal: string) {
  const ids = Object.keys(state.projects);
  const accessible = ids.filter((id) => projectRole(state, principal, id));
  const owned = ids.filter((id) => projectRole(state, principal, id) === 'owner');
  const editable = ids.filter(
    (id) =>
      ['owner', 'editor'].includes(projectRole(state, principal, id) ?? '') &&
      !state.projects[id]!.archived,
  );
  return createScopedAbility(
    [
      { action: 'read', subject: 'Project', conditions: { in: ['id', accessible] } },
      { action: 'administer', subject: 'Project', conditions: { in: ['id', owned] } },
      { action: 'read', subject: 'Task', conditions: { in: ['projectId', accessible] } },
      { action: 'edit', subject: 'Task', conditions: { in: ['projectId', editable] } },
      {
        action: 'edit',
        subject: 'Task',
        fields: ['privateNote'],
        conditions: { not: { in: ['projectId', owned] } },
        inverted: true,
      },
    ],
    {
      id: { column: 'id', type: 'string' },
      projectId: { column: 'project_id', type: 'string' },
      privateNote: { column: 'private_note', type: 'string' },
    },
  );
}
export function visibleTasks(state: ProjectTaskState, principal: string): Task[] {
  const scope = taskReadScope(state, principal);
  return Object.values(state.tasks).filter((task) =>
    matchesScope(scope, task as unknown as Record<string, unknown>),
  );
}
function projectOutput(
  state: ProjectTaskState,
  context: ExecutionContext,
  value: unknown,
): unknown {
  if (Array.isArray(value)) return value.map((item) => projectOutput(state, context, item));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  if ('items' in object) return { ...object, items: projectOutput(state, context, object.items) };
  if (typeof object.projectId === 'string') {
    const { privateNote, ...publicFields } = object;
    return projectRole(state, context.principalId, object.projectId) === 'owner'
      ? object
      : publicFields;
  }
  if ('members' in object && typeof object.id === 'string') {
    const { members, ...publicFields } = object;
    return projectRole(state, context.principalId, object.id) === 'owner' ? object : publicFields;
  }
  return object;
}
export const projectTaskPolicy: AuthorizationPort<ProjectTaskState> = {
  authorize({ capability, input, context, state, previousState, phase }) {
    const operation = capability.id;
    const args = input as Record<string, unknown>;
    if (!knownOperations.has(operation)) return { allowed: false, reason: 'NO_POLICY' };
    if (operation === 'project.create')
      return { allowed: state.workspaceOwnerId === context.principalId };
    if (operation === 'project.list' || operation === 'task.list') return { allowed: true };
    const evaluate = (snapshot: ProjectTaskState): boolean => {
      let projectId: string | undefined;
      if (operation.startsWith('project.')) projectId = String(args.id);
      else if (operation === 'task.create') projectId = String(args.projectId);
      else {
        const id = String(args.id);
        projectId =
          (Object.hasOwn(snapshot.tasks, id) ? snapshot.tasks[id]?.projectId : undefined) ??
          (phase === 'replay' && Object.hasOwn(snapshot.deletedTasks, id)
            ? snapshot.deletedTasks[id]
            : undefined);
      }
      if (!projectId) return false;
      if (
        context.grant?.resources &&
        !context.grant.resources.includes(
          `${operation.startsWith('project.') ? 'project' : 'task'}:${String(args.id)}`,
        )
      )
        return false;
      const { ability } = domainAbility(snapshot, context.principalId);
      const subject = operation.startsWith('project.')
        ? { __type: 'Project', id: projectId }
        : { __type: 'Task', projectId };
      if (phase === 'replay' || capability.kind === 'query') return ability.can('read', subject);
      if (operation.startsWith('project.')) return ability.can('administer', subject);
      if (!ability.can('edit', subject)) return false;
      return Object.keys(args)
        .filter((field) => field !== 'id' && field !== 'projectId')
        .every((field) => ability.can('edit', subject, field));
    };
    // Deletes have no proposed object; authorize their original project and retained tombstone.
    if (operation === 'task.delete' && phase === 'commit')
      return { allowed: !!previousState && evaluate(previousState) };
    return {
      allowed: evaluate(state) && (!previousState || evaluate(previousState)),
      reason: 'RESOURCE_OR_FIELD_DENIED',
    };
  },
  projectOutput({ state, context, output }) {
    return projectOutput(state, context, output);
  },
  canReadEvent({ state, context, event }) {
    const separator = event.resource.indexOf(':');
    const type = event.resource.slice(0, separator);
    const id = event.resource.slice(separator + 1);
    const projectId =
      type === 'project'
        ? id
        : ((Object.hasOwn(state.tasks, id) ? state.tasks[id]?.projectId : undefined) ??
          (Object.hasOwn(state.deletedTasks, id) ? state.deletedTasks[id] : undefined));
    return !!projectId && !!projectRole(state, context.principalId, projectId);
  },
};
