import { ApplicationError, type InputOf, type JsonValue } from '@agent-native/contracts';
import { own, put, type HandlerContribution } from '@agent-native/runtime';
import { workflowOperations as ops } from './contracts';
import {
  expired,
  isFinished,
  service,
  view,
  type Context,
  type Instance,
  type WorkflowsServices,
  type WorkflowsState,
} from './state';
import { dueInstances } from './due';
import { advance, failStep } from './steps';

export { workflowsPolicy } from './policy';
export {
  createWorkflowsState,
  type WorkflowsService,
  type WorkflowsServices,
  type WorkflowsState,
} from './state';

const DAY = 86_400_000;

const show = (instance: Instance, ctx: Context) => {
  const { definitions, now } = service(ctx);
  return view(instance, ctx.context.principalId, definitions.get(instance.workflow), now());
};
const visible = (instance: Instance, ctx: Context) =>
  instance.starter === ctx.context.principalId ||
  ctx.state.owners.includes(ctx.context.principalId);
/** An instance the caller may see; anything else reads as missing. */
function found(ctx: Context, id: string, starterOnly = false): Instance {
  const instance = own(ctx.state.instances, id);
  if (
    !instance ||
    (starterOnly ? instance.starter !== ctx.context.principalId : !visible(instance, ctx))
  )
    throw new ApplicationError('NOT_FOUND', 'Workflow instance unavailable');
  return instance;
}
function touch(instance: Instance, ctx: Context, at: number) {
  instance.seq++;
  instance.updatedAt = at;
  ctx.change(`workflow:${instance.id}`);
}
const progress = (instance: Instance) => ({
  id: instance.id,
  seq: instance.seq,
  status: instance.status,
});

/**
 * Start an instance under a grant narrowed from the caller's: the workflow's operations and
 * what they invoke, until the earlier of the caller's grant and a day past the deadline. A
 * caller whose grant does not cover a step is refused here, not at that step.
 */
function start(input: InputOf<typeof ops.start>, ctx: Context) {
  const { definitions, now, newId } = service(ctx);
  const definition = definitions.get(input.workflow);
  if (!definition) throw new ApplicationError('NOT_FOUND', 'Workflow unavailable');
  let parsed: Record<string, JsonValue>;
  try {
    parsed = definition.workflow.input.parse(input.input) as Record<string, JsonValue>;
  } catch (error) {
    throw new ApplicationError(
      'INVALID_INPUT',
      `Invalid input for workflow ${input.workflow}: ${error instanceof Error ? error.message : 'rejected'}`.slice(
        0,
        500,
      ),
    );
  }
  if (
    input.key !== undefined &&
    Object.values(ctx.state.instances).some(
      (other) => other.workflow === input.workflow && other.key === input.key && !isFinished(other),
    )
  )
    throw new ApplicationError(
      'CONFLICT',
      `Workflow ${input.workflow} already runs for ${input.key}`,
    );
  const caller = ctx.context.grant;
  const uncovered = caller
    ? definition.operations.filter((operation) => !caller.operations.includes(operation))
    : [];
  if (uncovered.length)
    throw new ApplicationError('FORBIDDEN', `Your grant does not cover ${uncovered.join(', ')}`);
  const at = now();
  const deadline = at + definition.workflow.maxDurationMs;
  const expiresAt = Math.min(caller?.expiresAt ?? Infinity, deadline + DAY);
  if (expiresAt <= at) throw new ApplicationError('FORBIDDEN', 'Your grant has expired');
  const id = newId();
  const instance: Instance = {
    id,
    workflow: input.workflow,
    version: definition.workflow.version,
    fingerprint: definition.fingerprint,
    starter: ctx.context.principalId,
    ...(input.key === undefined ? {} : { key: input.key }),
    status: 'running',
    seq: 0,
    index: 0,
    attempts: 0,
    nextAt: at,
    startedAt: at,
    updatedAt: at,
    deadline,
    grant: {
      operations: [...definition.operations, ops.advance.id, ops.fail.id],
      ...(caller?.resources ? { resources: [...caller.resources, `workflow:${id}`] } : {}),
      ...(caller?.creates ? { creates: [...caller.creates] } : {}),
      expiresAt,
    },
    input: parsed,
    values: {},
    compensations: [],
    history: [],
  };
  put(ctx.state.instances, id, instance);
  ctx.change(`workflow:${id}`, 'created');
  return show(instance, ctx);
}

/** Undo what completed, then end cancelled; an instance already undoing ends cancelled. */
function cancel(input: { id: string }, ctx: Context) {
  const instance = found(ctx, input.id);
  if (isFinished(instance))
    throw new ApplicationError('CONFLICT', 'The workflow instance has finished');
  const at = service(ctx).now();
  instance.cancelledBy = ctx.context.principalId;
  delete instance.pending;
  delete instance.wait;
  // A stalled compensation is tried again; one already running just ends cancelled.
  if (instance.status !== 'compensating') {
    delete instance.stalledReason;
    instance.attempts = 0;
    if (instance.compensations.length) {
      instance.status = 'compensating';
      instance.nextAt = at;
    } else {
      instance.status = 'cancelled';
      instance.finishedAt = at;
    }
  }
  touch(instance, ctx, at);
  return show(instance, ctx);
}

/** Its grant renewed, the stopped step or compensation runs again from a fresh attempt count. */
function retry(input: { id: string }, ctx: Context) {
  const instance = found(ctx, input.id, true);
  const { definitions, now } = service(ctx);
  const at = now();
  const lapsed = expired(instance, at);
  if (
    !(lapsed || instance.status === 'stalled' || instance.status === 'failed') ||
    instance.resolvedAt
  )
    throw new ApplicationError('CONFLICT', 'Only a stalled or failed workflow instance is retried');
  if (definitions.get(instance.workflow)?.fingerprint !== instance.fingerprint)
    throw new ApplicationError(
      'CONFLICT',
      'The workflow definition changed since this instance started; cancel it to undo its steps',
    );
  instance.grant.expiresAt = Math.max(at, instance.deadline) + DAY;
  if (!lapsed) {
    instance.status = instance.stalledReason === 'COMPENSATION_FAILED' ? 'compensating' : 'running';
    delete instance.stalledReason;
    delete instance.error;
    delete instance.finishedAt;
    delete instance.wait;
    delete instance.pending;
    instance.attempts = 0;
  }
  instance.nextAt = at;
  touch(instance, ctx, at);
  return show(instance, ctx);
}

function resolveInstance(input: { id: string }, ctx: Context) {
  const instance = found(ctx, input.id, true);
  const at = service(ctx).now();
  if (!(expired(instance, at) || instance.status === 'stalled' || instance.status === 'failed'))
    throw new ApplicationError(
      'CONFLICT',
      'Only a stalled or failed workflow instance is resolved',
    );
  if (instance.resolvedAt === undefined) {
    instance.status = 'failed';
    instance.finishedAt ??= at;
    instance.resolvedAt = at;
    instance.resolvedBy = ctx.context.principalId;
    touch(instance, ctx, at);
  }
  return show(instance, ctx);
}

/** The instance at `seq`, or undefined when the runner's view is stale and nothing may change. */
function atSeq(ctx: Context, input: { id: string; seq: number }) {
  const instance = own(ctx.state.instances, input.id);
  if (!instance) throw new ApplicationError('NOT_FOUND', 'Workflow instance unavailable');
  const current =
    input.seq === instance.seq && !isFinished(instance) && instance.status !== 'stalled';
  return { instance, current };
}

export const workflowsHandlers: HandlerContribution<WorkflowsState, WorkflowsServices>[] = [
  { capability: ops.start, handle: (input, ctx) => start(input as never, ctx) },
  {
    capability: ops.list,
    handle(input, ctx) {
      const { workflow, open } = input as InputOf<typeof ops.list>;
      const items = Object.values(ctx.state.instances)
        .filter(
          (instance) =>
            visible(instance, ctx) &&
            (workflow === undefined || instance.workflow === workflow) &&
            (open === undefined || isFinished(instance) !== open),
        )
        .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
        .map((instance) => show(instance, ctx));
      return { items };
    },
  },
  {
    capability: ops.get,
    handle: (input, ctx) => show(found(ctx, (input as { id: string }).id), ctx),
  },
  { capability: ops.cancel, handle: (input, ctx) => cancel(input as never, ctx) },
  { capability: ops.retry, handle: (input, ctx) => retry(input as never, ctx) },
  { capability: ops.resolve, handle: (input, ctx) => resolveInstance(input as never, ctx) },
  { capability: ops.due, handle: (_input, ctx) => dueInstances(ctx) },
  {
    capability: ops.advance,
    async handle(input, ctx) {
      const { id, seq, cursor } = input as InputOf<typeof ops.advance>;
      const { instance, current } = atSeq(ctx, { id, seq });
      if (!current) return progress(instance);
      const { definitions, now } = service(ctx);
      const at = now();
      await advance(instance, definitions.get(instance.workflow), ctx, at, cursor);
      touch(instance, ctx, at);
      return progress(instance);
    },
  },
  {
    capability: ops.fail,
    handle(input, ctx) {
      const { id, seq, code, message } = input as InputOf<typeof ops.fail>;
      const { instance, current } = atSeq(ctx, { id, seq });
      if (!current) return progress(instance);
      const { definitions, now } = service(ctx);
      const at = now();
      failStep(instance, definitions.get(instance.workflow), { code, message }, at);
      touch(instance, ctx, at);
      return progress(instance);
    },
  },
];
