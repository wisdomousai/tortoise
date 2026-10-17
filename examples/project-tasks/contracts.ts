import { z } from 'zod';
import {
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  proposalOperations,
} from '@agent-native/contracts';

export { proposalOperations };
import { projectTasksOs } from './os';

const id = z.string().min(1).max(128);
const role = z.enum(['owner', 'editor', 'viewer']);
export const statusSchema = z.enum(['todo', 'doing', 'done']);
export const projectSchema = z.strictObject({
  id,
  revision: z.number().int().min(0),
  name: z.string(),
  archived: z.boolean(),
  members: z.record(z.string(), role).optional(),
});
export const taskSchema = z.strictObject({
  id,
  revision: z.number().int().min(0),
  projectId: id,
  title: z.string(),
  description: z.string(),
  status: statusSchema,
  privateNote: z.string().optional(),
});
const byId = jsonSchema(z.strictObject({ id }));
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const descriptions: Readonly<Record<string, string>> = {
  'project.create':
    'Create a project as workspace owner. The creator becomes a project owner. Returns the project and its committed revision.',
  'project.get':
    'Read one accessible project and its current revision. The membership map is included only for project owners.',
  'project.list':
    'List accessible projects with optional archive filtering. Authorization is applied before pagination and the count includes only accessible matching projects.',
  'project.archive':
    'Archive a project as its owner. Tasks remain readable, but task edits are blocked until the project is restored. Supply project:<id> in expectedRevisions to detect concurrent edits.',
  'project.restore':
    'Restore an archived project as its owner, permitting ordinary task edits again. Supply project:<id> in expectedRevisions to detect concurrent edits.',
  'project.set-member':
    'Set or remove a project membership as project owner. A null role removes access; workspace-owner membership is fixed. Permission changes invalidate affected views. Supply project:<id> in expectedRevisions.',
  'task.create':
    'Create a todo task in an accessible, active project as owner or editor. Only owners may supply privateNote. Returns the task and its committed revision.',
  'task.get':
    'Read one accessible task and its current revision. privateNote is included only for project owners. Use this revision in a later mutation expectedRevisions map.',
  'task.list':
    'List tasks in accessible projects, with public-field search, status/project filters and pagination. Authorization precedes filtering and count calculation. privateNote is owner-only and cannot be searched or sorted.',
  'task.update':
    'Edit task title or description in an active project as owner or editor; privateNote is owner-only. Project reassignment is not accepted. Supply task:<id> in expectedRevisions to prevent overwriting a concurrent edit.',
  'task.set-status':
    'Set a task to todo, doing or done in an active project as owner or editor. Supply task:<id> in expectedRevisions to detect concurrent changes.',
  'task.delete':
    'Remove a task from an active project as owner or editor. This capability has no restore operation. Supply task:<id> in expectedRevisions to detect concurrent changes.',
};
function operation<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I extends z.ZodType,
  O extends z.ZodType,
>(name: Id, kind: Kind, input: I, output: O, action: string, resourceType: string) {
  const description = descriptions[name];
  if (!description) throw new Error(`Missing operation description: ${name}`);
  return defineCapability({
    id: name,
    kind,
    description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission: { action, resourceType },
    dependencies: ['project', 'task'],
    ui: { binding: name },
  });
}
const idInput = z.strictObject({ id });
export const operations = {
  projectCreate: operation(
    'project.create',
    'command',
    z.strictObject({ name: z.string().min(1).max(200) }),
    projectSchema,
    'create',
    'Project',
  ),
  projectGet: operation('project.get', 'query', idInput, projectSchema, 'read', 'Project'),
  projectList: operation(
    'project.list',
    'query',
    z.strictObject({ ...page, archived: z.boolean().optional() }),
    z.strictObject({ items: z.array(projectSchema), count: z.number().int() }),
    'read',
    'Project',
  ),
  projectArchive: operation(
    'project.archive',
    'command',
    idInput,
    projectSchema,
    'manage',
    'Project',
  ),
  projectRestore: operation(
    'project.restore',
    'command',
    idInput,
    projectSchema,
    'manage',
    'Project',
  ),
  projectSetMember: operation(
    'project.set-member',
    'command',
    z.strictObject({ id, principalId: id, role: role.nullable() }),
    projectSchema,
    'manage',
    'Project',
  ),
  taskCreate: operation(
    'task.create',
    'command',
    z.strictObject({
      projectId: id,
      title: z.string().min(1).max(200),
      description: z.string().max(10000).optional(),
      privateNote: z.string().max(10000).optional(),
    }),
    taskSchema,
    'create',
    'Task',
  ),
  taskGet: operation('task.get', 'query', idInput, taskSchema, 'read', 'Task'),
  taskList: operation(
    'task.list',
    'query',
    z.strictObject({
      ...page,
      projectId: id.optional(),
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
      privateNote: z.string().max(10000).optional(),
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
  taskDelete: operation(
    'task.delete',
    'command',
    idInput,
    z.strictObject({ id }),
    'delete',
    'Task',
  ),
} as const;
export const projectTasksModule = defineModule({
  id: 'project-tasks',
  capabilities: [...Object.values(operations), ...Object.values(proposalOperations)],
  workflows: [
    {
      id: 'project-planning',
      operations: ['project.create', 'task.create', 'task.list', 'task.set-status'],
      text: 'Create a project from the brief, add concrete tasks, inspect the scoped task list, and update each task status as work progresses.',
    },
  ],
  agents: [
    // Not resource-scoped: grant resources match exactly, so a grant listing only the selected
    // project would refuse the proposal records it creates. Project roles bound the run instead.
    defineAgent({
      id: 'project.planner',
      title: 'Project planner',
      instructions:
        'Break the selected project into concrete tasks. Read the project and its task list first, then propose task.create for each missing task (resource project:<id>) and task.set-status for tasks the brief says are done (resource task:<id>, with the task revision you read as baseRevisions). A person accepts or rejects each proposal. Never propose deleting tasks or changing members.',
      operations: ['project.get', 'task.list', 'task.create', 'task.set-status', 'proposal.list'],
      model: 'any',
      output: 'propose',
      budgets: { turns: 12, toolCalls: 40, wallTimeMs: 300_000 },
    }),
  ],
  os: projectTasksOs,
});
export { byId };
