import { z } from 'zod';
import {
  blobRefSchema,
  defineAgent,
  effectOutcomeSchema,
  defineCapability,
  defineModule,
  jsonSchema,
  approvalOperations,
  type BlobLimits,
} from '@tortoise/contracts';

export { approvalOperations };
import { attachmentLimits } from './attachments';
import { fieldServiceOs } from './os';

const id = z.string().min(1).max(128);
const role = z.enum(['dispatcher', 'technician', 'customer']);
export const statusSchema = z.enum(['todo', 'doing', 'done']);
export const workOrderSchema = z.strictObject({
  id,
  revision: z.number().int().min(0),
  name: z.string(),
  site: z.string().optional(),
  closed: z.boolean(),
  members: z.record(z.string(), role).optional(),
});
export const taskSchema = z.strictObject({
  id,
  revision: z.number().int().min(0),
  workOrderId: id,
  title: z.string(),
  description: z.string(),
  status: statusSchema,
  internalNote: z.string().optional(),
  attachment: blobRefSchema.optional(),
  reminder: z.enum(['pending', 'accepted', 'rejected']).optional(),
});
const byId = jsonSchema(z.strictObject({ id }));
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const descriptions: Readonly<Record<string, string>> = {
  'work-order.create':
    'Create a work order for a customer site as workspace owner; the creator becomes its dispatcher. site is the address a technician travels to. Returns the work order and its committed revision.',
  'work-order.get':
    'Read one accessible work order and its current revision. The membership map is included only for its dispatchers.',
  'work-order.list':
    'List accessible work orders with an optional closed filter. Authorization is applied before pagination and the count includes only accessible matching work orders.',
  'work-order.close':
    'Close a work order as its dispatcher. Tasks remain readable, but task edits are blocked until the work order is reopened. Supply work-order:<id> in expectedRevisions to detect concurrent edits.',
  'work-order.reopen':
    'Reopen a closed work order as its dispatcher, permitting ordinary task edits again. Supply work-order:<id> in expectedRevisions to detect concurrent edits.',
  'work-order.set-member':
    'Set or remove a work order membership as its dispatcher: dispatcher, technician or customer. A null role removes access; workspace-owner membership is fixed. Permission changes invalidate affected views. Supply work-order:<id> in expectedRevisions.',
  'task.create':
    'Create a todo task in an accessible, open work order as dispatcher or technician. Only dispatchers may supply internalNote. An attachment is a blob reference uploaded first: a site photo (PNG or JPEG) or a PDF of at most 10 MiB. Returns the task and its committed revision.',
  'task.get':
    'Read one accessible task and its current revision. internalNote is included only for dispatchers of its work order. Use this revision in a later mutation expectedRevisions map.',
  'task.list':
    'List tasks in accessible work orders, with public-field search, status/work order filters and pagination. Authorization precedes filtering and count calculation. internalNote is dispatcher-only and cannot be searched or sorted.',
  'task.update':
    'Edit task title or description in an open work order as dispatcher or technician; internalNote is dispatcher-only. Moving a task to another work order is not accepted. Supply task:<id> in expectedRevisions to prevent overwriting a concurrent edit.',
  'task.set-status':
    'Set a task to todo, doing or done in an open work order as dispatcher or technician. Supply task:<id> in expectedRevisions to detect concurrent changes.',
  'task.remind':
    'Remind yourself of a task with a notification on your desktop or phone. It waits until one of them is running; its Mark done action sets the task to done as you, if you still may. Needs dispatcher or technician on an open work order.',
  'task-reminders.effect.complete':
    'Integration principal only: record whether a desktop or phone showed a task reminder.',
  'task.delete':
    'Remove a task from an open work order as dispatcher or technician, with its attachment. This capability has no restore operation. Supply task:<id> in expectedRevisions to detect concurrent changes.',
};
function operation<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I extends z.ZodType,
  O extends z.ZodType,
>(
  name: Id,
  kind: Kind,
  input: I,
  output: O,
  action: string,
  resourceType: string,
  blobs?: BlobLimits,
  extra: { integration?: { target: string; delivery: 'outbox' }; ui?: { exception: string } } = {},
) {
  const description = descriptions[name];
  if (!description) throw new Error(`Missing operation description: ${name}`);
  return defineCapability({
    id: name,
    kind,
    description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission: { action, resourceType },
    dependencies: ['work-order', 'task'],
    ui: extra.ui ?? { binding: name },
    ...(blobs ? { blobs } : {}),
    ...(extra.integration ? { integration: extra.integration } : {}),
  });
}
const idInput = z.strictObject({ id });
export const operations = {
  workOrderCreate: operation(
    'work-order.create',
    'command',
    z.strictObject({
      name: z.string().min(1).max(200),
      site: z.string().min(1).max(200).optional(),
    }),
    workOrderSchema,
    'create',
    'WorkOrder',
  ),
  workOrderGet: operation('work-order.get', 'query', idInput, workOrderSchema, 'read', 'WorkOrder'),
  workOrderList: operation(
    'work-order.list',
    'query',
    z.strictObject({ ...page, closed: z.boolean().optional() }),
    z.strictObject({ items: z.array(workOrderSchema), count: z.number().int() }),
    'read',
    'WorkOrder',
  ),
  workOrderClose: operation(
    'work-order.close',
    'command',
    idInput,
    workOrderSchema,
    'manage',
    'WorkOrder',
  ),
  workOrderReopen: operation(
    'work-order.reopen',
    'command',
    idInput,
    workOrderSchema,
    'manage',
    'WorkOrder',
  ),
  workOrderSetMember: operation(
    'work-order.set-member',
    'command',
    z.strictObject({ id, principalId: id, role: role.nullable() }),
    workOrderSchema,
    'manage',
    'WorkOrder',
  ),
  taskCreate: operation(
    'task.create',
    'command',
    z.strictObject({
      workOrderId: id,
      title: z.string().min(1).max(200),
      description: z.string().max(10000).optional(),
      internalNote: z.string().max(10000).optional(),
      attachment: blobRefSchema.optional(),
    }),
    taskSchema,
    'create',
    'Task',
    attachmentLimits,
  ),
  taskGet: operation('task.get', 'query', idInput, taskSchema, 'read', 'Task'),
  taskList: operation(
    'task.list',
    'query',
    z.strictObject({
      ...page,
      workOrderId: id.optional(),
      status: statusSchema.optional(),
      search: z.string().max(200).optional(),
      sort: z.enum(['title', 'status']).optional(),
    }),
    z.strictObject({ items: z.array(taskSchema), count: z.number().int() }),
    'read',
    'Task',
  ),
  taskUpdate: operation(
    'task.update',
    'command',
    z.strictObject({
      id,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(10000).optional(),
      internalNote: z.string().max(10000).optional(),
    }),
    taskSchema,
    'update',
    'Task',
  ),
  taskSetStatus: operation(
    'task.set-status',
    'command',
    z.strictObject({ id, status: statusSchema }),
    taskSchema,
    'update',
    'Task',
  ),
  taskRemind: operation(
    'task.remind',
    'command',
    idInput,
    taskSchema,
    'update',
    'Task',
    undefined,
    { integration: { target: 'task-reminders', delivery: 'outbox' } },
  ),
  taskRemindersComplete: operation(
    'task-reminders.effect.complete',
    'command',
    z.strictObject({
      effectId: z.string().min(1).max(128),
      outcome: effectOutcomeSchema,
      fence: z.number().int().min(1).optional(),
    }),
    z.strictObject({}),
    'complete',
    'TaskReminder',
    undefined,
    {
      ui: {
        exception:
          'Called by the notification dispatcher with the outcome of a reminder; people see it on the task.',
      },
    },
  ),
  taskDelete: operation(
    'task.delete',
    'command',
    idInput,
    z.strictObject({ id }),
    'delete',
    'Task',
  ),
} as const;
export const fieldServiceModule = defineModule({
  id: 'field-service',
  capabilities: Object.values(operations),
  workflows: [
    {
      id: 'work-order-planning',
      operations: ['work-order.create', 'task.create', 'task.list', 'task.set-status'],
      text: 'Create a work order from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.',
    },
  ],
  os: fieldServiceOs,
});

/**
 * The planner agent, in a module of its own because it needs the `approval` feature's
 * operations: an application composes `fieldServiceModule` without approval requests, and adds
 * this module and the feature to run the planner.
 */
export const workOrderPlannerModule = defineModule({
  id: 'work-order-planner',
  capabilities: [],
  requires: ['field-service', 'approval'],
  agents: [
    // Not resource-scoped: grant resources match exactly, so a grant listing only the selected
    // work order would refuse the approval request records it creates. Work order roles bound the run instead.
    defineAgent({
      id: 'work-order.planner',
      title: 'Work order planner',
      instructions:
        'Break the selected work order into concrete tasks. Read the work order and its task list first, then request approval for task.create for each missing task (resource work-order:<id>) and task.set-status for tasks the brief says are done (resource task:<id>, with the task revision you read as baseRevisions). A person approves or rejects each request. Never request approval for deleting tasks or changing members.',
      operations: [
        'work-order.get',
        'task.list',
        'task.create',
        'task.set-status',
        'approval.list',
      ],
      model: 'any',
      output: 'request-approval',
      budgets: { turns: 12, toolCalls: 40, wallTimeMs: 300_000 },
    }),
  ],
});
export { byId };
