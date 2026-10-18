import {
  agentInstructions,
  ApplicationError,
  errorEnvelope,
  operationToolSchema,
  type Catalog,
  type EventLogPort,
} from '@agent-native/contracts';
import { agentGrant, type DelegationGrant, type ExecutionContext } from '@agent-native/runtime';
import { chooseHarness, createRunSupervisor, runAuditRecord } from '@agent-native/agents';
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
 * Model-facing tools: the operations agent triggers may call, each taking the same
 * `{ input, expectedRevisions }` envelope as the host's run tools. Listing only those keeps a
 * small local model's tool list short; the run's grant still decides every call.
 */
function toolDefinitions(application: HostedApplication, operations: ReadonlySet<string>) {
  return application.catalog.operations
    .filter((operation) => operations.has(operation.id))
    .map((operation) => ({
      operation: operation.id,
      description: operation.description || operation.id,
      inputSchema: operationToolSchema(operation),
    }));
}

/**
 * Tools over the application for trigger runs. Instance comes from the context the loop
 * registered for the run ID, never from the call. Keys arrive prefixed with the run ID.
 */
function createRunTools(
  application: HostedApplication,
  contexts: ReadonlyMap<string, ExecutionContext>,
  agentOperations: ReadonlySet<string>,
): ToolPort {
  return {
    definitions: toolDefinitions(application, agentOperations),
    async execute(operation, body, call) {
      const context = contexts.get(call.runId);
      if (!context) throw new ApplicationError('FORBIDDEN', 'Run instance unavailable');
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

/**
 * Start trigger runs in a supervisor of their own and wait for each to finish. An agent run
 * uses the first available harness that meets the agent's model requirement; when none is
 * available the run fails with UNAVAILABLE instead of using a harness the agent does not allow.
 */
export function createTriggerRuns(
  application: HostedApplication,
  jobs: ReadonlyMap<string, Job>,
  agentHarnesses: readonly Harness[],
  triggers: Iterable<ResolvedTrigger>,
  eventLog?: () => EventLogPort | undefined,
) {
  const contexts = new Map<string, ExecutionContext>();
  const actors = new Map<string, { principalId: string; workspaceId: string }>();
  const agentOperations = new Set(
    [...triggers].flatMap((trigger) => ('agent' in trigger.run ? trigger.operations : [])),
  );
  const supervisor = createRunSupervisor({
    harnesses: [createJobHarness(jobs), ...agentHarnesses],
    tools: createRunTools(application, contexts, agentOperations),
    // Each run's start and end go to the audit log as the grant's issuer, after the fact. The
    // issuer is taken when the run starts, since the run's context is gone by the time it ends.
    onRun(snapshot, change) {
      const context = contexts.get(snapshot.id);
      if (change === 'started' && context)
        actors.set(snapshot.id, {
          principalId: context.principalId,
          workspaceId: context.workspaceId,
        });
      const actor = actors.get(snapshot.id);
      if (change === 'ended') actors.delete(snapshot.id);
      void eventLog?.()
        ?.append([runAuditRecord(snapshot, change, actor)])
        .catch(() => undefined);
    },
  });
  return async function run(
    trigger: ResolvedTrigger,
    context: ExecutionContext,
    start: { event?: TriggerEvent; slot?: number },
  ): Promise<RunOutcome> {
    const id = context.runId!;
    contexts.set(id, context);
    try {
      const harness =
        'agent' in trigger.run
          ? await chooseHarness(trigger.model!, agentHarnesses, trigger.demand)
          : undefined;
      await supervisor.start({
        id,
        ...startInput(application.catalog, trigger, start, harness),
        budget: { ...trigger.budgets },
        ...(trigger.model ? { model: trigger.model } : {}),
        ...(trigger.demand ? { demand: trigger.demand } : {}),
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
  catalog: Catalog,
  trigger: ResolvedTrigger,
  start: { event?: TriggerEvent; slot?: number },
  agentHarness: Harness | undefined,
) {
  if ('job' in trigger.run || !agentHarness) {
    if (!('job' in trigger.run)) throw new Error(`Trigger ${trigger.id} has no agent harness`);
    const prompt: JobPrompt = { job: trigger.run.job, trigger: trigger.id, ...start };
    return { harnessId: JOB_HARNESS, prompt: JSON.stringify(prompt) };
  }
  // The changed record goes in as the run's selection, which the model reads with its tools.
  // The agent's instructions come first, so a trigger prompt only says what happened.
  const { event } = start;
  const cause = event
    ? `Started by ${event.type} of ${event.resource} (revision ${event.revision}) through ${event.operation}.`
    : `Started by the schedule (slot ${start.slot}).`;
  return {
    harnessId: agentHarness.id,
    prompt: `${agentInstructions(catalog, trigger.run.agent)}\n\n${trigger.prompt ?? trigger.title}\n\n${cause}`,
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
