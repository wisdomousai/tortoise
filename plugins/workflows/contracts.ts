import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  jsonValueSchema,
} from '@agent-native/contracts';

const id = z.string().min(1).max(256);
const time = z.number().int();
const code = z.string().max(64);
const message = z.string().max(500);

/** Every instance runs under this run ID prefix; `workflow.start` refuses a caller inside one. */
export const RUN_PREFIX = 'wf:';
export const runIdOf = (instance: string) => `${RUN_PREFIX}${instance}`;

export const workflowStatuses = [
  'running',
  'waiting',
  'compensating',
  'succeeded',
  'compensated',
  'failed',
  'cancelled',
  'stalled',
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];
/** No step runs again in these, unless a person retries a failed instance. */
export const finished: readonly WorkflowStatus[] = [
  'succeeded',
  'compensated',
  'failed',
  'cancelled',
];

/** Why an instance waits for a person. */
export const stalledReasons = [
  'DEFINITION_CHANGED',
  'GRANT_EXPIRED',
  'COMPENSATION_FAILED',
] as const;

export const historyEntrySchema = z.strictObject({
  step: id,
  outcome: z.enum(['completed', 'skipped', 'retried', 'failed', 'timed-out', 'compensated']),
  at: time,
  code: code.optional(),
  message: message.optional(),
});

/**
 * One workflow instance. The starter sees its input, the values later steps read, its history
 * and its error; the workspace owner sees the fields up to `finishedAt` only.
 */
export const instanceSchema = z.strictObject({
  id,
  workflow: id,
  version: z.number().int().min(1),
  starter: id,
  key: id.optional(),
  status: z.enum(workflowStatuses),
  stalledReason: z.enum(stalledReasons).optional(),
  /** The step that runs next, or that is being undone while compensating. */
  step: id.optional(),
  startedAt: time,
  updatedAt: time,
  deadline: time,
  finishedAt: time.optional(),
  grantExpiresAt: time.optional(),
  input: z.record(z.string(), jsonValueSchema).optional(),
  /** By step: the paths later steps read from its result, and from its effects as `#<index>.<path>`. */
  values: z.record(z.string(), z.record(z.string(), jsonValueSchema)).optional(),
  history: z.array(historyEntrySchema).optional(),
  error: z.strictObject({ step: id, code, message }).optional(),
  /** Set while an awaited effect is held for reconciliation. */
  held: z.boolean().optional(),
  resolvedAt: time.optional(),
  resolvedBy: id.optional(),
  cancelledBy: id.optional(),
});
export type InstanceView = z.output<typeof instanceSchema>;

const byId = z.strictObject({ id });
const progress = jsonSchema(
  z.strictObject({ id, seq: z.number().int().min(0), status: z.enum(workflowStatuses) }),
);
const people = 'People only, and only the starter.';

export const workflowOperations = {
  start: defineCapability({
    id: 'workflow.start',
    kind: 'command',
    description:
      "Start a declared workflow with its input. The instance runs its steps as you, narrowed to the workflow's operations, until it finishes, at most until its maximum duration. With a `key`, a second running instance of the same workflow and key is refused with CONFLICT. Refused from inside a workflow run.",
    input: jsonSchema(
      z.strictObject({
        workflow: id,
        input: z.record(z.string(), jsonValueSchema),
        key: id.optional(),
      }),
    ),
    output: jsonSchema(instanceSchema),
    permission: { action: 'start', resourceType: 'Workflow' },
    ui: {
      exception:
        "Started by the application command a workflow names as its `start`, or by an agent; the input is the workflow's own.",
    },
    audit: { fields: ['workflow', 'key'] },
  }),
  list: defineCapability({
    id: 'workflow.list',
    kind: 'query',
    description:
      'Workflow instances you started, with their values and history, newest first. The workspace owner also sees everyone else’s, status only.',
    input: jsonSchema(z.strictObject({ workflow: id.optional(), open: z.boolean().optional() })),
    output: jsonSchema(z.strictObject({ items: z.array(instanceSchema) })),
    permission: { action: 'read', resourceType: 'Workflow' },
    ui: { binding: 'workflows.instances' },
  }),
  get: defineCapability({
    id: 'workflow.get',
    kind: 'query',
    description: 'One workflow instance, as `workflow.list` shows it to you.',
    input: jsonSchema(byId),
    output: jsonSchema(instanceSchema),
    permission: { action: 'read', resourceType: 'Workflow' },
    ui: { binding: 'workflows.instances' },
  }),
  cancel: defineCapability({
    id: 'workflow.cancel',
    kind: 'command',
    description:
      'Cancel a workflow instance you started (or, as the workspace owner, anyone’s). The steps it completed are undone in reverse order by their compensations, then it is cancelled.',
    input: jsonSchema(byId),
    output: jsonSchema(instanceSchema),
    permission: { action: 'cancel', resourceType: 'Workflow' },
    ui: { binding: 'workflows.instances' },
    audit: { fields: ['id'] },
  }),
  retry: defineCapability({
    id: 'workflow.retry',
    kind: 'command',
    description: `Run a stalled or failed workflow instance again from the step that stopped it, with a fresh attempt count and its grant renewed until a day after its deadline. An instance whose definition changed cannot be retried; cancel it. ${people}`,
    input: jsonSchema(byId),
    output: jsonSchema(instanceSchema),
    permission: { action: 'retry', resourceType: 'Workflow' },
    ui: { binding: 'workflows.instances' },
    audit: { fields: ['id'] },
  }),
  resolve: defineCapability({
    id: 'workflow.resolve',
    kind: 'command',
    description: `Mark a stalled or failed workflow instance as handled after acting on it yourself. A stalled one becomes failed. ${people}`,
    input: jsonSchema(byId),
    output: jsonSchema(instanceSchema),
    permission: { action: 'retry', resourceType: 'Workflow' },
    ui: { binding: 'workflows.instances' },
    audit: { fields: ['id'] },
  }),
  due: defineCapability({
    id: 'workflow.due',
    kind: 'query',
    description:
      'Instances the runner advances now, and waiting instances with the resource types they watch. Called only by the workflow runner as the workspace owner.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({
        items: z.array(
          z.strictObject({
            id,
            seq: z.number().int().min(0),
            starter: id,
            grant: z.strictObject({
              operations: z.array(z.string()),
              resources: z.array(z.string()).optional(),
              creates: z.array(z.string()).optional(),
              expiresAt: time,
            }),
            /** Advance now; otherwise advance once a resource of a watched type changed. */
            now: z.boolean(),
            watch: z
              .strictObject({ types: z.array(z.string()), cursor: z.number().int().min(0) })
              .optional(),
          }),
        ),
      }),
    ),
    permission: { action: 'run', resourceType: 'Workflow' },
    ui: { exception: 'Read only by the workflow runner.' },
  }),
  advance: defineCapability({
    id: 'workflow.advance',
    kind: 'command',
    description:
      "Run the instance's next step, or its next compensation, as a nested call in this command's transaction, and record the result with it. A `seq` other than the instance's changes nothing. Called only by the workflow runner as the starter.",
    input: jsonSchema(
      z.strictObject({
        id,
        seq: z.number().int().min(0),
        cursor: z.number().int().min(0).optional(),
      }),
    ),
    output: progress,
    permission: { action: 'run', resourceType: 'Workflow' },
    invokes: 'any',
    ui: { exception: 'Written only by the workflow runner; people follow it in workflow.list.' },
    audit: { fields: ['id', 'seq'] },
  }),
  fail: defineCapability({
    id: 'workflow.fail',
    kind: 'command',
    description:
      "Record that the instance's current step or compensation failed: retry it later, start undoing the completed steps, or stall for a person. A `seq` other than the instance's changes nothing. Called only by the workflow runner as the starter.",
    input: jsonSchema(z.strictObject({ id, seq: z.number().int().min(0), code, message })),
    output: progress,
    permission: { action: 'run', resourceType: 'Workflow' },
    ui: { exception: 'Written only by the workflow runner; people follow it in workflow.list.' },
    audit: { fields: ['id', 'seq', 'code'] },
  }),
} as const;

/** Browser-safe module of the workflows plugin. */
export const workflowsModule = defineModule({
  id: 'workflow',
  capabilities: Object.values(workflowOperations),
});
