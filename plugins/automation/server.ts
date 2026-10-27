import { ApplicationError, type InputOf, type OutputOf } from '@agent-native/contracts';
import {
  isDelegated,
  own,
  put,
  type AuthorizationPort,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import { automationModule, automationOperations as ops } from './contracts';
import type { ResolvedTrigger } from './triggers';
import { runPrefix } from './run-ids';

type Grant = OutputOf<typeof ops.grantIssue>;
type Failure = OutputOf<typeof ops.failureResolve>;
interface Progress {
  cursor?: number;
  slot?: number;
  lastRunAt?: number;
  lastOutcome?: 'succeeded' | 'failed';
}

/** Trigger grants, their progress and failed runs, under `state.automation`. */
export interface AutomationState {
  grants: Record<string, Grant>;
  progress: Record<string, Progress>;
  failures: Record<string, Failure>;
}
export const createAutomationState = (): AutomationState => ({
  grants: {},
  progress: {},
  failures: {},
});

/** What the plugin resolved when it opened: the triggers, a clock and an ID source. */
export interface AutomationService {
  readonly triggers: ReadonlyMap<string, ResolvedTrigger>;
  readonly now: () => number;
  readonly newId: () => string;
}
export interface AutomationServices {
  readonly automation?: AutomationService;
}
type Context = HandlerContext<AutomationState, AutomationServices>;

function service(ctx: Context): AutomationService {
  if (!ctx.services.automation)
    throw new ApplicationError('INTERNAL', 'Automation plugin is not open');
  return ctx.services.automation;
}
const active = (grant: Grant, now: number) =>
  grant.revokedAt === undefined && grant.expiresAt > now;
/** The caller's own grant `id`; someone else's reads as missing. */
function ownGrant(ctx: Context, id: string): Grant {
  const grant = own(ctx.state.grants, id);
  if (!grant || grant.issuedBy !== ctx.context.principalId)
    throw new ApplicationError('NOT_FOUND', 'Trigger grant unavailable');
  return grant;
}

function issue(input: InputOf<typeof ops.grantIssue>, ctx: Context): Grant {
  const { triggers, now, newId } = service(ctx);
  const trigger = triggers.get(input.trigger);
  if (!trigger) throw new ApplicationError('NOT_FOUND', 'Trigger unavailable');
  const at = now();
  const principal = ctx.context.principalId;
  // One active grant per trigger: the latest person to enable it replaces any earlier grant, so
  // an event never starts two runs.
  for (const grant of Object.values(ctx.state.grants))
    if (grant.trigger === trigger.id && active(grant, at)) {
      Object.assign(grant, { revokedAt: at, revokedBy: principal });
      ctx.change(`trigger-grant:${grant.id}`);
    }
  const grant: Grant = {
    id: newId(),
    trigger: trigger.id,
    issuedBy: principal,
    operations: [...trigger.operations],
    issuedAt: at,
    expiresAt: at + input.expiresInMs,
  };
  put(ctx.state.grants, grant.id, grant);
  ctx.change(`trigger-grant:${grant.id}`, 'created');
  return grant;
}

function record(input: InputOf<typeof ops.progressRecord>, ctx: Context) {
  const grant = own(ctx.state.grants, input.grant);
  if (!grant) throw new ApplicationError('NOT_FOUND', 'Trigger grant unavailable');
  const { now, newId } = service(ctx);
  const progress = own(ctx.state.progress, grant.id) ?? {};
  // Progress only moves forward, so a replayed or late record never rewinds the loop.
  if (input.cursor !== undefined) progress.cursor = Math.max(progress.cursor ?? 0, input.cursor);
  if (input.slot !== undefined) progress.slot = Math.max(progress.slot ?? 0, input.slot);
  if (input.run) {
    progress.lastRunAt = now();
    progress.lastOutcome = input.run.outcome;
    if (input.run.outcome === 'failed') {
      const failure: Failure = {
        id: newId(),
        trigger: grant.trigger,
        grant: grant.id,
        runId: input.run.id,
        code: input.run.code ?? 'FAILED',
        message: input.run.message ?? 'The run failed',
        at: progress.lastRunAt,
      };
      put(ctx.state.failures, failure.id, failure);
      ctx.change(`trigger-failure:${failure.id}`, 'created');
    }
  }
  put(ctx.state.progress, grant.id, progress);
  ctx.change(`trigger-grant:${grant.id}`);
  return { grant: grant.id };
}

function summaries(ctx: Context) {
  const { triggers, now } = service(ctx);
  const at = now();
  const grants = Object.values(ctx.state.grants).filter((grant) => active(grant, at));
  const failures = Object.values(ctx.state.failures);
  return [...triggers.values()].map((trigger) => {
    const grant = grants.find((candidate) => candidate.trigger === trigger.id);
    const progress = grant ? own(ctx.state.progress, grant.id) : undefined;
    return {
      id: trigger.id,
      title: trigger.title,
      on: 'event' in trigger.on ? ('event' as const) : ('schedule' as const),
      runs: 'agent' in trigger.run ? ('agent' as const) : ('job' as const),
      ...(grant ? { grant } : {}),
      ...(progress?.cursor === undefined ? {} : { cursor: progress.cursor }),
      ...(progress?.slot === undefined ? {} : { slot: progress.slot }),
      ...(progress?.lastRunAt === undefined ? {} : { lastRunAt: progress.lastRunAt }),
      ...(progress?.lastOutcome ? { lastOutcome: progress.lastOutcome } : {}),
      openFailures: failures.filter(
        (failure) => failure.trigger === trigger.id && !failure.resolvedAt,
      ).length,
    };
  });
}

export const automationHandlers: HandlerContribution<AutomationState, AutomationServices>[] = [
  { capability: ops.triggerList, handle: (_input, ctx) => ({ items: summaries(ctx) }) },
  { capability: ops.grantIssue, handle: (input, ctx) => issue(input as never, ctx) },
  {
    capability: ops.grantRenew,
    handle(input, ctx) {
      const { id, expiresInMs } = input as InputOf<typeof ops.grantRenew>;
      const grant = ownGrant(ctx, id);
      if (grant.revokedAt !== undefined)
        throw new ApplicationError('CONFLICT', 'A revoked grant cannot be renewed');
      grant.expiresAt = service(ctx).now() + expiresInMs;
      ctx.change(`trigger-grant:${grant.id}`);
      return grant;
    },
  },
  {
    capability: ops.grantRevoke,
    handle(input, ctx) {
      const grant = ownGrant(ctx, (input as { id: string }).id);
      if (grant.revokedAt === undefined)
        Object.assign(grant, { revokedAt: service(ctx).now(), revokedBy: ctx.context.principalId });
      ctx.change(`trigger-grant:${grant.id}`);
      return grant;
    },
  },
  { capability: ops.progressRecord, handle: (input, ctx) => record(input as never, ctx) },
  {
    capability: ops.failureList,
    handle(input, ctx) {
      const { open } = input as { open?: boolean };
      const mine = (failure: Failure) =>
        own(ctx.state.grants, failure.grant)?.issuedBy === ctx.context.principalId;
      const items = Object.values(ctx.state.failures)
        .filter((failure) => mine(failure) && (open === undefined || !failure.resolvedAt === open))
        .sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || b.at - a.at);
      return { items };
    },
  },
  {
    capability: ops.failureResolve,
    handle(input, ctx) {
      const failure = own(ctx.state.failures, (input as { id: string }).id);
      if (!failure || own(ctx.state.grants, failure.grant)?.issuedBy !== ctx.context.principalId)
        throw new ApplicationError('NOT_FOUND', 'Failure unavailable');
      if (!failure.resolvedAt)
        Object.assign(failure, {
          resolvedAt: service(ctx).now(),
          resolvedBy: ctx.context.principalId,
        });
      ctx.change(`trigger-failure:${failure.id}`);
      return failure;
    },
  },
];

const known = new Set<string>(automationModule.capabilities.map((capability) => capability.id));
const personal = new Set<string>([
  ops.grantIssue.id,
  ops.grantRenew.id,
  ops.grantRevoke.id,
  ops.failureResolve.id,
]);

/**
 * Issuing, renewing and revoking a trigger grant and resolving a failure are for people: a
 * delegated run or agent never creates or extends a trigger grant. Handlers limit each to
 * the caller's own grants. Progress is recorded only by the trigger loop, which acts as the
 * grant's issuer with a run ID under that grant (`auto:<grant>:...`), a context only the
 * in-process loop creates. Reads are open to every caller: they show configuration and the
 * caller's own failures. No event is disclosed; screens follow the queries.
 */
export const automationPolicy: AuthorizationPort<AutomationState> = {
  authorize({ capability, context, input, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (personal.has(capability.id))
      return { allowed: !isDelegated(context), reason: 'PERSON_REQUIRED' };
    if (capability.id === ops.progressRecord.id) {
      const grant = own(state.grants, String((input as { grant?: unknown }).grant));
      return {
        allowed:
          !!grant &&
          grant.issuedBy === context.principalId &&
          context.runId?.startsWith(runPrefix(grant.id)) === true,
        reason: 'TRIGGER_LOOP_ONLY',
      };
    }
    return { allowed: true };
  },
  canReadEvent: () => false,
};
