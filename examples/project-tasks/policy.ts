import {
  definePolicy,
  own,
  type Access,
  type ExecutionContext,
  type OperationRule,
} from '@agent-native/runtime';
import type { ProjectTaskState, Role, Task } from './domain';
import { createScopedAbility, matchesScope } from '@agent-native/adapters/casl';
import { operations as taskOperations, proposalOperations } from './contracts';

const operations = { ...taskOperations, ...proposalOperations };

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
type Rule = OperationRule<ProjectTaskState, Role>;
const projectOf: Rule['container'] = (input) => String(input.id);
/** A task's project from authoritative state; a replay may also read the retained tombstone. */
const taskProject: Rule['container'] = (input, state, phase) => {
  const id = String(input.id);
  return (
    own(state.tasks, id)?.projectId ??
    (phase === 'replay' ? own(state.deletedTasks, id) : undefined)
  );
};
const reads = (access: Access<ProjectTaskState, Role>) =>
  access.kind === 'query' || access.phase === 'replay';
/** Project operations: any role reads; only project owners administer. */
const onProject: Rule = {
  container: projectOf,
  grant: (input) => `project:${String(input.id)}`,
  allow: (access) =>
    reads(access) ||
    domainAbility(access.state, access.context.principalId).ability.can('administer', {
      __type: 'Project',
      id: access.container!,
    }),
  reason: 'RESOURCE_OR_FIELD_DENIED',
};
/** Task edits need `edit` on the project and on every field the input names. */
const editsTask = (access: Access<ProjectTaskState, Role>) => {
  const { ability } = domainAbility(access.state, access.context.principalId);
  const subject = { __type: 'Task', projectId: access.container! };
  if (reads(access)) return true;
  if (!ability.can('edit', subject)) return false;
  return Object.keys(access.input)
    .filter((field) => field !== 'id' && field !== 'projectId')
    .every((field) => ability.can('edit', subject, field));
};
const onTask = (container: Rule['container']): Rule => ({
  container,
  grant: (input) => `task:${String(input.id)}`,
  allow: editsTask,
  reason: 'RESOURCE_OR_FIELD_DENIED',
});
const projectEvent = { container: (id: string) => id };

/** The project a resource belongs to: a project, a task (or its tombstone) or a proposal. */
export function projectOfResource(state: ProjectTaskState, resource: string): string | undefined {
  const separator = resource.indexOf(':');
  const type = resource.slice(0, separator);
  const id = resource.slice(separator + 1);
  if (type === 'project') return own(state.projects, id) ? id : undefined;
  if (type === 'task') return own(state.tasks, id)?.projectId ?? own(state.deletedTasks, id);
  if (type === 'proposal') {
    const about = own(state.proposals, id)?.resource;
    return about && !about.startsWith('proposal:') ? projectOfResource(state, about) : undefined;
  }
  return undefined;
}
const proposalProject: Rule['container'] = (input, state) =>
  projectOfResource(state, `proposal:${String(input.id)}`);
/**
 * Any project member may propose and accept; accepting also passes the proposed task command's
 * own rule under the accepter, so a viewer's acceptance is refused there. Deciding needs a
 * person. Rejecting needs a role that could have made the change.
 */
const proposalRules = {
  [operations.proposalSubmit.id]: {
    container: (input, state) =>
      typeof input.resource === 'string' ? projectOfResource(state, input.resource) : undefined,
  },
  [operations.proposalAccept.id]: { container: proposalProject, person: true },
  [operations.proposalReject.id]: {
    container: proposalProject,
    roles: ['owner', 'editor'],
    person: true,
  },
  [operations.proposalExpire.id]: { container: proposalProject },
  // Handlers scope these to the caller's projects before filtering and counting.
  [operations.proposalList.id]: 'open',
  [operations.proposalGet.id]: 'open',
} satisfies Record<string, Rule | 'open'>;

/**
 * Project roles through CASL: owners administer and see private notes, editors edit tasks in
 * active projects, viewers read. Lists are scoped in their handlers before paging and counting.
 */
export const projectTaskPolicy = definePolicy<ProjectTaskState, Role>({
  roleOf: projectRole,
  operations: {
    [operations.projectCreate.id]: {
      allow: ({ state, context }) => state.workspaceOwnerId === context.principalId,
    },
    [operations.projectList.id]: 'open',
    [operations.taskList.id]: 'open',
    [operations.projectGet.id]: onProject,
    [operations.projectArchive.id]: onProject,
    [operations.projectRestore.id]: onProject,
    [operations.projectSetMember.id]: onProject,
    [operations.taskCreate.id]: onTask((input) => String(input.projectId)),
    [operations.taskGet.id]: onTask(taskProject),
    [operations.taskUpdate.id]: onTask(taskProject),
    [operations.taskSetStatus.id]: onTask(taskProject),
    [operations.taskRemind.id]: onTask(taskProject),
    // The notification dispatcher: the owner acting under its delegated grant, never a session.
    [operations.taskRemindersSettle.id]: {
      allow: ({ state, context }) =>
        state.workspaceOwnerId === context.principalId && context.grant !== undefined,
    },
    // Deletes have no proposed object; authorize their original project and retained tombstone.
    [operations.taskDelete.id]: { ...onTask(taskProject), commit: 'previous' },
    ...proposalRules,
  },
  events: {
    project: projectEvent,
    task: {
      container: (id, state) => own(state.tasks, id)?.projectId ?? own(state.deletedTasks, id),
    },
    proposal: { container: (id, state) => projectOfResource(state, `proposal:${id}`) },
  },
  projectOutput: ({ state, context, output }) => projectOutput(state, context, output),
});
