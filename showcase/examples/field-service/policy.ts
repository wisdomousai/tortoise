import {
  definePolicy,
  own,
  type Access,
  type ApprovalAccess,
  type ExecutionContext,
  type OperationRule,
} from '@tortoise/runtime';
import type { ServiceState, Role, Task } from './domain';
import { createScopedAbility, matchesScope } from '@tortoise/adapters/casl';
import { operations } from './contracts';

export function workOrderRole(
  state: ServiceState,
  principal: string,
  workOrderId: string,
): Role | undefined {
  const workOrder = Object.hasOwn(state.workOrders, workOrderId)
    ? state.workOrders[workOrderId]
    : undefined;
  if (!workOrder) return undefined;
  return state.localUserId === principal
    ? 'dispatcher'
    : Object.hasOwn(workOrder.members, principal)
      ? workOrder.members[principal]
      : undefined;
}
export function taskReadScope(state: ServiceState, principal: string) {
  return domainAbility(state, principal).scopeFor('read', 'Task');
}
function domainAbility(state: ServiceState, principal: string) {
  const ids = Object.keys(state.workOrders);
  const accessible = ids.filter((id) => workOrderRole(state, principal, id));
  const owned = ids.filter((id) => workOrderRole(state, principal, id) === 'dispatcher');
  const editable = ids.filter(
    (id) =>
      ['dispatcher', 'technician'].includes(workOrderRole(state, principal, id) ?? '') &&
      !state.workOrders[id]!.closed,
  );
  return createScopedAbility(
    [
      { action: 'read', subject: 'WorkOrder', conditions: { in: ['id', accessible] } },
      { action: 'administer', subject: 'WorkOrder', conditions: { in: ['id', owned] } },
      { action: 'read', subject: 'Task', conditions: { in: ['workOrderId', accessible] } },
      { action: 'edit', subject: 'Task', conditions: { in: ['workOrderId', editable] } },
      {
        action: 'edit',
        subject: 'Task',
        fields: ['internalNote'],
        conditions: { not: { in: ['workOrderId', owned] } },
        inverted: true,
      },
    ],
    {
      id: { column: 'id', type: 'string' },
      workOrderId: { column: 'work_order_id', type: 'string' },
      internalNote: { column: 'internal_note', type: 'string' },
    },
  );
}
export function visibleTasks(state: ServiceState, principal: string): Task[] {
  const scope = taskReadScope(state, principal);
  return Object.values(state.tasks).filter((task) =>
    matchesScope(scope, task as unknown as Record<string, unknown>),
  );
}
function projectOutput(state: ServiceState, context: ExecutionContext, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => projectOutput(state, context, item));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  if ('items' in object) return { ...object, items: projectOutput(state, context, object.items) };
  if (typeof object.workOrderId === 'string') {
    const { internalNote, ...publicFields } = object;
    return workOrderRole(state, context.principalId, object.workOrderId) === 'dispatcher'
      ? object
      : publicFields;
  }
  if ('members' in object && typeof object.id === 'string') {
    const { members, ...publicFields } = object;
    return workOrderRole(state, context.principalId, object.id) === 'dispatcher'
      ? object
      : publicFields;
  }
  return object;
}
type Rule = OperationRule<ServiceState, Role>;
const workOrderOf: Rule['container'] = (input) => String(input.id);
/** A task's work order from authoritative state; a replay may also read the retained tombstone. */
const taskWorkOrder: Rule['container'] = (input, state, phase) => {
  const id = String(input.id);
  return (
    own(state.tasks, id)?.workOrderId ??
    (phase === 'replay' ? own(state.deletedTasks, id) : undefined)
  );
};
const reads = (access: Access<ServiceState, Role>) =>
  access.kind === 'query' || access.phase === 'replay';
/** Work order operations: any role reads; only its dispatchers administer. */
const onWorkOrder: Rule = {
  container: workOrderOf,
  grant: (input) => `work-order:${String(input.id)}`,
  allow: (access) =>
    reads(access) ||
    domainAbility(access.state, access.context.principalId).ability.can('administer', {
      __type: 'WorkOrder',
      id: access.container!,
    }),
  reason: 'RESOURCE_OR_FIELD_DENIED',
};
/** Task edits need `edit` on the work order and on every field the input names. */
const editsTask = (access: Access<ServiceState, Role>) => {
  const { ability } = domainAbility(access.state, access.context.principalId);
  const subject = { __type: 'Task', workOrderId: access.container! };
  if (reads(access)) return true;
  if (!ability.can('edit', subject)) return false;
  return Object.keys(access.input)
    .filter((field) => field !== 'id' && field !== 'workOrderId')
    .every((field) => ability.can('edit', subject, field));
};
const onTask = (container: Rule['container']): Rule => ({
  container,
  grant: (input) => `task:${String(input.id)}`,
  allow: editsTask,
  reason: 'RESOURCE_OR_FIELD_DENIED',
});
const workOrderEvent = { container: (id: string) => id };

/** The work order a resource belongs to: a work order or a task (or its tombstone). */
export function workOrderOfResource(state: ServiceState, resource: string): string | undefined {
  const separator = resource.indexOf(':');
  const type = resource.slice(0, separator);
  const id = resource.slice(separator + 1);
  if (type === 'work-order') return own(state.workOrders, id) ? id : undefined;
  if (type === 'task') return own(state.tasks, id)?.workOrderId ?? own(state.deletedTasks, id);
  return undefined;
}

/**
 * Who may do what with approval requests, for the `approval` feature. Every approval request
 * names the work order or task it is about, and the caller needs a role in that record's work order:
 * any role requests, approves and reads, and rejecting needs a role that could have made the
 * change. Approving also passes the requested task command's own rule under the approver, so a
 * customer's approval is refused there, and the feature refuses deciding to a delegated caller.
 * Listing needs a role in some work order or the workspace's ownership.
 */
export const approvalAccess = (state: ServiceState): ApprovalAccess => ({
  allows(context, action, resource) {
    if (resource === undefined)
      return (
        action === 'read' &&
        (state.localUserId === context.principalId ||
          Object.keys(state.workOrders).some((id) => workOrderRole(state, context.principalId, id)))
      );
    const workOrder = workOrderOfResource(state, resource);
    const role = workOrder && workOrderRole(state, context.principalId, workOrder);
    if (!role) return false;
    return action !== 'reject' || role !== 'customer';
  },
});

/**
 * Work order roles through CASL: dispatchers administer and see internal notes, technicians edit tasks in
 * active work orders, customers read. Lists are scoped in their handlers before paging and counting.
 */
export const servicePolicy = definePolicy<ServiceState, Role>({
  roleOf: workOrderRole,
  operations: {
    [operations.workOrderCreate.id]: {
      allow: ({ state, context }) => state.localUserId === context.principalId,
    },
    [operations.workOrderList.id]: 'open',
    [operations.taskList.id]: 'open',
    [operations.workOrderGet.id]: onWorkOrder,
    [operations.workOrderClose.id]: onWorkOrder,
    [operations.workOrderReopen.id]: onWorkOrder,
    [operations.workOrderSetMember.id]: onWorkOrder,
    [operations.taskCreate.id]: onTask((input) => String(input.workOrderId)),
    [operations.taskGet.id]: onTask(taskWorkOrder),
    [operations.taskUpdate.id]: onTask(taskWorkOrder),
    [operations.taskSetStatus.id]: onTask(taskWorkOrder),
    [operations.taskRemind.id]: onTask(taskWorkOrder),
    // The reminder dispatcher: the local user acting under its delegated grant, never a session.
    [operations.taskRemindersComplete.id]: {
      allow: ({ state, context }) =>
        state.localUserId === context.principalId && context.grant !== undefined,
    },
    // Deletes have no proposed object; authorize their original work order and retained tombstone.
    [operations.taskDelete.id]: { ...onTask(taskWorkOrder), commit: 'previous' },
  },
  events: {
    'work-order': workOrderEvent,
    task: {
      container: (id, state) => own(state.tasks, id)?.workOrderId ?? own(state.deletedTasks, id),
    },
  },
  projectOutput: ({ state, context, output }) => projectOutput(state, context, output),
});
