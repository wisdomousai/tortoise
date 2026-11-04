import { ApplicationError, type JsonValue } from '@tortoise/contracts';
import type { HandlerContext } from '@tortoise/runtime';
import { finished, type InstanceView, type WorkflowStatus, type stalledReasons } from './contracts';
import type { Definition } from './definitions';

export interface InstanceGrant {
  readonly operations: readonly string[];
  readonly resources?: readonly string[];
  readonly creates?: readonly string[];
  expiresAt: number;
}

/** A completed step's compensation, with its input read when the step completed. */
export interface Compensation {
  readonly step: string;
  readonly command: string;
  readonly input: JsonValue;
}

/** One workflow instance as stored. `seq` grows with every advance, so a replay is exact. */
export interface Instance {
  readonly id: string;
  readonly workflow: string;
  readonly version: number;
  readonly fingerprint: string;
  readonly starter: string;
  readonly key?: string;
  status: WorkflowStatus;
  stalledReason?: (typeof stalledReasons)[number];
  seq: number;
  /** Index of the step that runs next. */
  index: number;
  /** Failed attempts of the current step or compensation. */
  attempts: number;
  nextAt: number;
  readonly startedAt: number;
  updatedAt: number;
  readonly deadline: number;
  finishedAt?: number;
  readonly grant: InstanceGrant;
  readonly input: Record<string, JsonValue>;
  values: Record<string, Record<string, JsonValue>>;
  /** The effects the current step enqueued, while it awaits them. */
  pending?: { readonly effects: readonly string[] };
  /** When the current wait began and the journal cursor it last checked at. */
  wait?: { readonly since: number; cursor?: number };
  compensations: Compensation[];
  /** Who cancelled it; set while the compensations run. */
  cancelledBy?: string;
  history: NonNullable<InstanceView['history']>;
  error?: { step: string; code: string; message: string };
  held?: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
}

/** Local users and instances, under `state.workflow`. */
export interface WorkflowsState {
  localUsers: string[];
  instances: Record<string, Instance>;
}
export const createWorkflowsState = (localUserId: string): WorkflowsState => ({
  localUsers: [localUserId],
  instances: {},
});

/** What the plugin resolved when it opened. */
export interface WorkflowsService {
  readonly definitions: ReadonlyMap<string, Definition>;
  readonly now: () => number;
  readonly newId: () => string;
}
export interface WorkflowsServices {
  readonly workflow?: WorkflowsService;
}
export type Context = HandlerContext<WorkflowsState, WorkflowsServices>;

export function service(ctx: Context): WorkflowsService {
  if (!ctx.services.workflow)
    throw new ApplicationError('INTERNAL', 'Workflows plugin is not open');
  return ctx.services.workflow;
}

export const isFinished = (instance: Instance) => finished.includes(instance.status);
/** A running instance whose grant expired waits for its starter to retry it. */
export const expired = (instance: Instance, now: number) =>
  !isFinished(instance) && instance.status !== 'stalled' && instance.grant.expiresAt <= now;

/** The step the instance runs next, or undoes while compensating. */
export function currentStep(instance: Instance, definition: Definition | undefined) {
  if (instance.status === 'compensating') return instance.compensations.at(-1)?.step;
  return isFinished(instance) ? undefined : definition?.workflow.steps[instance.index]?.id;
}

/** The instance as `viewer` sees it: everything for its starter, status for a local user. */
export function view(
  instance: Instance,
  viewer: string,
  definition: Definition | undefined,
  now: number,
): InstanceView {
  const lapsed = expired(instance, now);
  const step = currentStep(instance, definition);
  const status: InstanceView = {
    id: instance.id,
    workflow: instance.workflow,
    version: instance.version,
    starter: instance.starter,
    ...(instance.key === undefined ? {} : { key: instance.key }),
    status: lapsed ? 'stalled' : instance.status,
    ...(lapsed
      ? { stalledReason: 'GRANT_EXPIRED' as const }
      : instance.stalledReason
        ? { stalledReason: instance.stalledReason }
        : {}),
    ...(step === undefined ? {} : { step }),
    startedAt: instance.startedAt,
    updatedAt: instance.updatedAt,
    deadline: instance.deadline,
    ...(instance.finishedAt === undefined ? {} : { finishedAt: instance.finishedAt }),
  };
  if (viewer !== instance.starter) return status;
  return {
    ...status,
    grantExpiresAt: instance.grant.expiresAt,
    input: instance.input,
    values: instance.values,
    history: instance.history,
    ...(instance.error ? { error: instance.error } : {}),
    ...(instance.held ? { held: true } : {}),
    ...(instance.resolvedAt === undefined
      ? {}
      : { resolvedAt: instance.resolvedAt, resolvedBy: instance.resolvedBy! }),
    ...(instance.cancelledBy === undefined ? {} : { cancelledBy: instance.cancelledBy }),
  };
}
