import { ApplicationError, errorEnvelope, type Catalog } from '@agent-native/contracts';
import { agentGrant, type DelegationGrant, type ExecutionContext } from '@agent-native/runtime';
import { createRunSupervisor } from '@agent-native/agents';
import type { Harness, ToolPort } from '@agent-native/agents/types';
import type { HostedApplication } from '@agent-native/host/application';
import type { OutputOf } from '@agent-native/contracts';
import type { automationOperations } from './contracts';
import { createJobHarness, JOB_HARNESS, type Job, type JobPrompt, type TriggerEvent } from './jobs';
import type { ResolvedTrigger } from './triggers';

export type Grant = NonNullable<
  OutputOf<typeof automationOperations.triggerList>['items'][number]['grant']
>;
export interface RunOutcome {
  readonly id: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly code?: string;
  readonly message?: string;
}

/**
 * The context one trigger run executes under: the grant's issuer, narrowed to the grant's
 * operations (and, for an agent, its definition), expiring at the earlier of the grant's expiry
 * and the run's wall-time budget, and bound to the run. Policy still authorizes every call as
 * that person, so a role they lost since issuing is refused.
 */
export function runContext(
  catalog: Catalog,
  trigger: ResolvedTrigger,
  grant: Grant,
  run: { id: string; workspaceId: string; now: number; resource?: string },
): ExecutionContext {
  const principalId = grant.issuedBy;
  const standing: DelegationGrant = {
    operations: [...grant.operations],
    expiresAt: grant.expiresAt,
    principalId,
    workspaceId: run.workspaceId,
  };
  const delegation =
    'agent' in trigger.run
      ? agentGrant(
          catalog,
          trigger.run.agent,
          { principalId, workspaceId: run.workspaceId, grant: standing },
          { runId: run.id, now: run.now, ...(run.resource ? { resources: [run.resource] } : {}) },
        )
      : {
          ...standing,
          expiresAt: Math.min(grant.expiresAt, run.now + trigger.budgets.wallTimeMs),
          runId: run.id,
        };
  return {
    principalId,
    workspaceId: run.workspaceId,
    runId: run.id,
    channel: 'harness',
    grant: delegation,
  };
}

/**
 * Tools over the application for trigger runs. Authority comes from the context the loop
 * registered for the run ID, never from the call. Keys arrive prefixed with the run ID.
 */
function createRunTools(
  application: HostedApplication,
  contexts: ReadonlyMap<string, ExecutionContext>,
): ToolPort {
  return {
    async execute(operation, body, call) {
      const context = contexts.get(call.runId);
      if (!context) throw new ApplicationError('FORBIDDEN', 'Run authority unavailable');
      const { input, expectedRevisions } = (body ?? {}) as {
        input?: unknown;
        expectedRevisions?: Record<string, number>;
      };
      const definition = application.catalog.operations.find((value) => value.id === operation);
      if (!definition) throw new ApplicationError('NOT_FOUND', 'Unknown operation');
      const request = {
        operation,
        input,
        ...(expectedRevisions ? { expectedRevisions } : {}),
        ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      };
      const scoped = { ...context, signal: call.signal };
      return definition.kind === 'query'
        ? application.queryRaw(request, scoped)
        : application.invokeRaw(request, scoped);
    },
  };
}

/** Start trigger runs in a supervisor of their own and wait for each to finish. */
export function createTriggerRuns(
  application: HostedApplication,
  jobs: ReadonlyMap<string, Job>,
  agentHarness: Harness | undefined,
) {
  const contexts = new Map<string, ExecutionContext>();
  const supervisor = createRunSupervisor({
    harnesses: [createJobHarness(jobs), ...(agentHarness ? [agentHarness] : [])],
    tools: createRunTools(application, contexts),
  });
  return async function run(
    trigger: ResolvedTrigger,
    context: ExecutionContext,
    start: { event?: TriggerEvent; slot?: number },
  ): Promise<RunOutcome> {
    const id = context.runId!;
    contexts.set(id, context);
    try {
      await supervisor.start({
        id,
        ...startInput(trigger, start, agentHarness),
        budget: { ...trigger.budgets },
      });
      for await (const _event of supervisor.events(id));
      const final = await supervisor.get(id);
      if (final?.state === 'succeeded') return { id, outcome: 'succeeded' };
      return {
        id,
        outcome: 'failed',
        code: (final?.failure?.code ?? final?.state ?? 'FAILED').toUpperCase().slice(0, 64),
        message: (final?.failure?.message ?? `Run ${final?.state ?? 'lost'}`).slice(0, 500),
      };
    } catch (error) {
      const envelope = errorEnvelope(error);
      return {
        id,
        outcome: 'failed',
        code: envelope.code,
        message: envelope.message.slice(0, 500),
      };
    } finally {
      contexts.delete(id);
    }
  };
}

function startInput(
  trigger: ResolvedTrigger,
  start: { event?: TriggerEvent; slot?: number },
  agentHarness: Harness | undefined,
) {
  if ('job' in trigger.run) {
    const prompt: JobPrompt = { job: trigger.run.job, trigger: trigger.id, ...start };
    return { harnessId: JOB_HARNESS, prompt: JSON.stringify(prompt) };
  }
  // The changed record goes in as the run's selection, which the model reads with its tools.
  const { event } = start;
  const cause = event
    ? `Started by ${event.type} of ${event.resource} (revision ${event.revision}) through ${event.operation}.`
    : `Started by the schedule (slot ${start.slot}).`;
  return {
    harnessId: agentHarness!.id,
    prompt: `${trigger.prompt ?? trigger.title}\n\n${cause}`,
    context: {
      trigger: trigger.id,
      ...(event
        ? {
            uiContext: {
              selectedResources: [event.resource],
              observedRevisions: { [event.resource]: event.revision },
            },
          }
        : {}),
    },
  };
}
