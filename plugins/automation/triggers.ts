import type { ModelDemand } from '@tortoise/agents/placement';
import {
  invokesClosure,
  type AgentBudgets,
  type Catalog,
  type ModelRequirement,
} from '@tortoise/contracts';
import { agentGrant } from '@tortoise/runtime';
import type { TriggerDefinition } from './contracts';
import type { Job } from './jobs';

/** A trigger checked against the catalog, with the operations its runs may call. */
export interface ResolvedTrigger extends TriggerDefinition {
  /** What a trigger grant for it lists: the job's operations or the agent's grant. */
  readonly operations: readonly string[];
  readonly budgets: Pick<AgentBudgets, 'toolCalls' | 'wallTimeMs'> & { readonly turns?: number };
  /** For an agent trigger, where the agent's model may run. */
  readonly model?: ModelRequirement;
  /** For an agent trigger, the agent's named models and ID. */
  readonly demand?: ModelDemand;
}

const DEFAULT_JOB_BUDGETS = { toolCalls: 100, wallTimeMs: 60_000 };
const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function runOperations(
  trigger: TriggerDefinition,
  catalog: Catalog,
  jobs: ReadonlyMap<string, Job>,
) {
  const { run } = trigger;
  if ('agent' in run) {
    const agent = catalog.agents.find((candidate) => candidate.id === run.agent);
    if (!agent) throw new Error(`Trigger ${trigger.id} runs unknown agent ${run.agent}`);
    // The agent's own narrowing, computed without an issuer grant; each run narrows again.
    const { operations } = agentGrant(
      catalog,
      agent.id,
      { principalId: '-', workspaceId: '-' },
      { now: 0 },
    );
    const demand: ModelDemand = {
      agent: agent.id,
      ...(agent.models ? { models: agent.models } : {}),
    };
    return { operations, budgets: agent.budgets, model: agent.model, demand };
  }
  if (!jobs.has(run.job)) throw new Error(`Trigger ${trigger.id} runs unregistered job ${run.job}`);
  // The job's operations and those they invoke, so its trigger grant covers the nested calls.
  return {
    operations: invokesClosure(catalog, run.operations),
    budgets: trigger.budgets ?? DEFAULT_JOB_BUDGETS,
  };
}

/**
 * Check every trigger when the plugin opens: a well-formed unique ID, known operations, a
 * registered job or a catalog agent, a schedule of at least a minute, and runs that cannot
 * start themselves again (no run operation is one the trigger reacts to).
 */
export function resolveTriggers(
  triggers: readonly TriggerDefinition[],
  catalog: Catalog,
  jobs: ReadonlyMap<string, Job>,
): Map<string, ResolvedTrigger> {
  const known = new Set(catalog.operations.map((operation) => operation.id));
  const resolved = new Map<string, ResolvedTrigger>();
  for (const trigger of triggers) {
    if (!ID.test(trigger.id) || resolved.has(trigger.id))
      throw new Error(`Invalid or duplicate trigger ID: ${trigger.id}`);
    const { model, demand, ...run } = runOperations(trigger, catalog, jobs);
    const { operations, budgets } = run;
    const unknown = operations.filter((operation) => !known.has(operation));
    if (unknown.length)
      throw new Error(`Trigger ${trigger.id} names unknown operations: ${unknown.join(', ')}`);
    if ('event' in trigger.on) {
      const watched = trigger.on.event.operations;
      if (!watched.length || watched.some((operation) => !known.has(operation)))
        throw new Error(`Trigger ${trigger.id} must react to known operations`);
      const loop = operations.filter((operation) => watched.includes(operation));
      if (loop.length)
        throw new Error(
          `Trigger ${trigger.id} would start itself again through ${loop.join(', ')}`,
        );
    } else if (
      !Number.isInteger(trigger.on.schedule.everyMs) ||
      trigger.on.schedule.everyMs < 60_000
    )
      throw new Error(`Trigger ${trigger.id} schedule must be at least one minute`);
    resolved.set(trigger.id, {
      ...trigger,
      operations,
      budgets,
      ...(model ? { model } : {}),
      ...(demand ? { demand } : {}),
    });
  }
  return resolved;
}
