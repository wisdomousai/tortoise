import { createHash } from 'node:crypto';
import type { ModelActivation, ModelEntry } from '@tortoise/agents/models';
import type { Harness } from '@tortoise/agents/types';
import { canonicalJson } from '@tortoise/contracts';
import {
  runAgentScenarios,
  scenarioRegressions,
  type AgentScenario,
  type AgentScenarioResult,
  type ScenarioApplication,
} from './agent-scenarios';

/**
 * The activation gate for a local model: before a new base model or fine-tune may serve, it
 * runs the agent scenarios of the definitions it would serve, and its results are compared with
 * the model it replaces, as the golden test does for station extractors. The result is a
 * `ModelActivation` that a managed model server checks against the digests it measures.
 */
export interface ModelGateOptions {
  readonly entry: ModelEntry;
  /** The candidate: a harness serving `entry`. */
  readonly candidate: Harness;
  /** The model it replaces, run on the same scenarios for comparison. */
  readonly baseline?: { readonly entry?: string; readonly harness: Harness };
  readonly scenarios: readonly AgentScenario[];
  /** A fresh application for each model, so both start from the same fixture state. */
  readonly application: () => ScenarioApplication | Promise<ScenarioApplication>;
  readonly now?: () => number;
}

export interface ModelGateResult {
  readonly activation: ModelActivation;
  readonly candidate: readonly AgentScenarioResult[];
  readonly baseline?: readonly AgentScenarioResult[];
}

/** `sha256:` over what the scenarios ask, so an activation names the exact bar it cleared. */
export function scenariosDigest(scenarios: readonly AgentScenario[]): string {
  const asked = scenarios.map(({ name, agent, task, resources, setup, script, expect }) =>
    // A JSON round trip drops absent fields, which canonical JSON refuses.
    JSON.parse(JSON.stringify({ name, agent, task, resources, setup, script, expect })),
  );
  return `sha256:${createHash('sha256').update(canonicalJson(asked)).digest('hex')}`;
}

/**
 * Run the gate. The candidate passes when it passes every scenario; a scenario the baseline
 * also fails still blocks it, and the regressions list shows what it lost against the baseline.
 * The candidate must serve `entry`, or nothing is run.
 */
export async function gateModel(options: ModelGateOptions): Promise<ModelGateResult> {
  const { entry, candidate, scenarios } = options;
  if (candidate.model?.entry !== entry.id)
    throw new Error(`The candidate harness does not serve model entry ${entry.id}`);
  if (!scenarios.length) throw new Error(`Model ${entry.id} has no scenarios to pass`);
  const run = async (harness: Harness) =>
    runAgentScenarios(scenarios, { application: await options.application(), harness });
  const results = await run(candidate);
  const baseline = options.baseline ? await run(options.baseline.harness) : undefined;
  const regressions = baseline ? scenarioRegressions(results, baseline) : [];
  const activation: ModelActivation = {
    entry: entry.id,
    base: entry.base.digest,
    ...(entry.adapter ? { adapter: entry.adapter.digest } : {}),
    ...(entry.adapter?.dataset ? { dataset: entry.adapter.dataset } : {}),
    scenarios: scenariosDigest(scenarios),
    passed: results.every((result) => result.passed),
    results: results.map((result) => ({ scenario: result.scenario, passed: result.passed })),
    regressions,
    ...(options.baseline?.entry ? { baseline: options.baseline.entry } : {}),
    at: (options.now ?? Date.now)(),
  };
  return { activation, candidate: results, ...(baseline ? { baseline } : {}) };
}
