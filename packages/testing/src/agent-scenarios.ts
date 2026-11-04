import { createRunSupervisor, deterministicHarness, localHarness } from '@tortoise/agents';
import type { Harness, ModelIdentity, ToolPort } from '@tortoise/agents/types';
import {
  agentInstructions,
  errorEnvelope,
  operationToolSchema,
  type Catalog,
} from '@tortoise/contracts';
import {
  agentGrant,
  type CommandResult,
  type ExecutionContext,
  type Invocation,
  type QueryResult,
} from '@tortoise/runtime';

/**
 * Agent scenarios: an agent definition, a task and fixture state, judged only by what the run
 * committed and requested approval for. Narration is never read, so the same scenario judges the deterministic
 * harness in CI and a real model when one is explicitly configured.
 */

/** The parts of a hosted application a scenario drives. */
export interface ScenarioApplication {
  readonly catalog: Catalog;
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandResult>;
  queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
}

/** A command expected to have committed: its operation and a subset of its input. */
export interface ExpectedCommand {
  readonly operation: string;
  readonly input?: unknown;
}

/** An approval request expected to have been submitted: the command it requests approval for and its record. */
export interface ExpectedApprovalRequest extends ExpectedCommand {
  readonly resource?: string;
}

/** What the deterministic harness plays in place of a model: the calls it makes, in order. */
export interface DeterministicScript {
  readonly commands: readonly {
    readonly operation: string;
    readonly input: unknown;
    readonly expectedRevisions?: Readonly<Record<string, number>>;
  }[];
  readonly text?: string;
  /** A question the harness asks before its calls; the scenario's first answer replies. */
  readonly question?: string;
}

export interface AgentScenario {
  readonly name: string;
  /** The agent definition under test, by ID. */
  readonly agent: string;
  /** What the person asks for, as a model reads it after the definition's instructions. */
  readonly task: string;
  /** Who starts the run. It acts under `agentGrant` of this context, never more. */
  readonly issuer: ExecutionContext;
  /** Records the run starts on, such as the person's selection. */
  readonly resources?: readonly string[];
  /** Fixture state: commands committed before the run, as the issuer unless they say otherwise. */
  readonly setup?: readonly (Invocation & { readonly context?: ExecutionContext })[];
  /** Played by the deterministic harness; a model harness ignores it. */
  readonly script?: DeterministicScript;
  /**
   * What the person answers to the run's questions, in order. A scenario with answers starts its
   * run as from a screen, where a person waits, so a model harness offers its ask tool. A
   * question past the last answer cancels the run.
   */
  readonly answers?: readonly string[];
  readonly expect: {
    /**
     * Every command the run committed, in order, other than approval requests. A commit not listed fails
     * the scenario, so an agent that writes more than it should is caught.
     */
    readonly commits?: readonly ExpectedCommand[];
    /** Every approval request the run submitted, in order. */
    readonly approvals?: readonly ExpectedApprovalRequest[];
    /** Calls that must have been refused, with the error code when given. */
    readonly refused?: readonly { readonly operation: string; readonly code?: string }[];
    /** How the run ended. Unchecked when absent. */
    readonly outcome?: 'succeeded' | 'failed';
    /** How many questions the run asked the person. Unchecked when absent. */
    readonly questions?: number;
  };
  /** Further checks over the result and the application, for example a record read afterwards. */
  check?(result: AgentScenarioResult, application: ScenarioApplication): void | Promise<void>;
}

/** One tool call of the run, as the application handled it. */
export interface AgentScenarioCall {
  readonly operation: string;
  readonly input: unknown;
  readonly outcome: 'committed' | 'read' | 'refused';
  readonly commandResult?: CommandResult;
  /** For a refusal: the error code and message the application returned. */
  readonly code?: string;
  readonly message?: string;
}

export interface AgentScenarioResult {
  readonly scenario: string;
  readonly harness: string;
  readonly runId: string;
  /** The run's final state in the supervisor. */
  readonly state: string;
  /** The model the run recorded, with its digests, when the harness names one. */
  readonly model?: ModelIdentity;
  readonly calls: readonly AgentScenarioCall[];
  /** Committed commands other than approval requests, with their command results. */
  readonly commits: readonly AgentScenarioCall[];
  /** Inputs of the committed `approval.request` calls. */
  readonly approvals: readonly {
    readonly operation: string;
    readonly input: unknown;
    readonly resource?: string;
  }[];
  /** The questions the run asked, in order. */
  readonly questions: readonly string[];
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export interface RunAgentScenarioOptions {
  readonly application: ScenarioApplication;
  readonly harness: Harness;
  /**
   * The clock the run's grant expiry is computed from. The instance checks expiry on its kernel
   * clock, so pass that clock, not a fixture clock the handlers read through their services.
   */
  readonly now?: () => number;
}

/** Whether `actual` contains `expected`: objects by their listed keys, arrays element by element. */
export function containsValue(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => containsValue(actual[index], item))
    );
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      containsValue((actual as Record<string, unknown>)[key], value),
    );
  }
  return Object.is(actual, expected);
}

const show = (value: unknown) => JSON.stringify(value);

/** The ordered list check shared by commits and approval requests: same length, each item contained. */
function compareList(
  label: string,
  actual: readonly { operation: string; input: unknown; resource?: string }[],
  expected: readonly ExpectedApprovalRequest[],
  failures: string[],
) {
  if (actual.length !== expected.length)
    failures.push(
      `Expected ${expected.length} ${label}, got ${actual.length}: ${show(actual.map((item) => item.operation))}`,
    );
  expected.forEach((want, index) => {
    const got = actual[index];
    if (!got) return;
    if (
      got.operation !== want.operation ||
      !containsValue(got.input, want.input) ||
      (want.resource !== undefined && got.resource !== want.resource)
    )
      failures.push(`${label} ${index + 1}: expected ${show(want)}, got ${show(got)}`);
  });
}

function judge(
  scenario: AgentScenario,
  state: string,
  calls: readonly AgentScenarioCall[],
  questions: readonly string[],
  failure?: { code: string; message: string },
) {
  const failures: string[] = [];
  const committed = calls.filter((call) => call.outcome === 'committed');
  const commits = committed.filter((call) => call.operation !== 'approval.request');
  const approvals = committed
    .filter((call) => call.operation === 'approval.request')
    .map((call) => {
      const input = call.input as { operation: string; input: unknown; resource?: string };
      return {
        operation: input.operation,
        input: input.input,
        ...(input.resource ? { resource: input.resource } : {}),
      };
    });
  const { expect } = scenario;
  if (expect.commits) compareList('commits', commits, expect.commits, failures);
  if (expect.approvals) compareList('approvals', approvals, expect.approvals, failures);
  for (const want of expect.refused ?? [])
    if (
      !calls.some(
        (call) =>
          call.outcome === 'refused' &&
          call.operation === want.operation &&
          (want.code === undefined || call.code === want.code),
      )
    )
      failures.push(
        `Expected ${want.operation} to be refused${want.code ? ` with ${want.code}` : ''}`,
      );
  if (expect.questions !== undefined && questions.length !== expect.questions)
    failures.push(`Expected ${expect.questions} questions, the run asked ${questions.length}`);
  if (expect.outcome && state !== expect.outcome)
    failures.push(
      `Expected the run to have ${expect.outcome}, it ended ${state}${failure ? ` (${failure.code}: ${failure.message})` : ''}`,
    );
  return { commits, approvals, failures };
}

/**
 * Tools for the run: the operations its grant names. Instance is the run's context, never the
 * call; every result is recorded, refusals included, before it goes back to the harness.
 */
function scenarioTools(
  application: ScenarioApplication,
  context: ExecutionContext,
  calls: AgentScenarioCall[],
): ToolPort {
  const operations = new Set(context.grant?.operations ?? []);
  return {
    definitions: application.catalog.operations
      .filter((operation) => operations.has(operation.id))
      .map((operation) => ({
        operation: operation.id,
        description: operation.description || operation.id,
        inputSchema: operationToolSchema(operation),
      })),
    async execute(operation, body, call) {
      const envelope = (body ?? {}) as {
        input?: unknown;
        expectedRevisions?: Record<string, number>;
      };
      const kind = application.catalog.operations.find((item) => item.id === operation)?.kind;
      const request: Invocation = {
        operation,
        input: envelope.input,
        ...(envelope.expectedRevisions ? { expectedRevisions: envelope.expectedRevisions } : {}),
        // The supervisor has already prefixed the key with the run ID.
        ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      };
      const scoped = { ...context, signal: call.signal };
      try {
        if (kind === 'query') {
          const result = await application.queryRaw(request, scoped);
          calls.push({ operation, input: envelope.input, outcome: 'read' });
          return result;
        }
        const commandResult = await application.invokeRaw(request, scoped);
        calls.push({ operation, input: envelope.input, outcome: 'committed', commandResult });
        return commandResult;
      } catch (error) {
        const { code, message } = errorEnvelope(error);
        calls.push({ operation, input: envelope.input, outcome: 'refused', code, message });
        throw error;
      }
    },
  };
}

/**
 * The prompt: for the deterministic harness its script, each call in the tool envelope a model
 * would send; for a model, the definition's instructions and the task.
 */
function promptFor(scenario: AgentScenario, harness: Harness, instructions: string) {
  if (harness.id === 'deterministic') {
    if (!scenario.script)
      throw new Error(`Scenario ${scenario.name} has no script for the deterministic harness`);
    const { commands, text, question } = scenario.script;
    return JSON.stringify({
      commands: commands.map(({ operation, input, expectedRevisions }) => ({
        operation,
        input: { input, ...(expectedRevisions ? { expectedRevisions } : {}) },
      })),
      ...(text ? { text } : {}),
      ...(question ? { question } : {}),
    });
  }
  return `${instructions}\n\n${scenario.task}`;
}

/**
 * Run one scenario: commit its setup, start the agent's run under `agentGrant`, wait for it to
 * end, then judge the command results and approval requests. Never throws for a failed expectation; the result
 * lists the failures, so a model gate can compare candidates.
 */
export async function runAgentScenario(
  scenario: AgentScenario,
  options: RunAgentScenarioOptions,
): Promise<AgentScenarioResult> {
  const { application, harness } = options;
  const now = options.now ?? Date.now;
  const agent = application.catalog.agents.find((item) => item.id === scenario.agent);
  if (!agent) throw new Error(`Scenario ${scenario.name}: unknown agent ${scenario.agent}`);
  for (const step of scenario.setup ?? []) {
    const { context = scenario.issuer, ...request } = step;
    await application.invokeRaw(request, context);
  }
  const runId = `scenario-${crypto.randomUUID()}`;
  const grant = agentGrant(application.catalog, agent.id, scenario.issuer, {
    now: now(),
    runId,
    ...(scenario.resources ? { resources: scenario.resources } : {}),
  });
  const context: ExecutionContext = {
    workspaceId: scenario.issuer.workspaceId,
    principalId: scenario.issuer.principalId,
    runId,
    channel: 'harness',
    grant,
  };
  const calls: AgentScenarioCall[] = [];
  const supervisor = createRunSupervisor({
    harnesses: [harness],
    tools: scenarioTools(application, context, calls),
  });
  const refusal = await supervisor
    .start({
      id: runId,
      harnessId: harness.id,
      prompt: promptFor(scenario, harness, agentInstructions(application.catalog, agent.id)),
      budget: { ...agent.budgets },
      model: agent.model,
      demand: { agent: agent.id, ...(agent.models ? { models: agent.models } : {}) },
      ...(scenario.resources || scenario.answers
        ? { context: { uiContext: { selectedResources: [...(scenario.resources ?? [])] } } }
        : {}),
    })
    .then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  if (refusal !== undefined) {
    // The supervisor refused the harness (a model requirement or entry it does not meet).
    const failures = [`Run refused: ${refusal}`];
    return {
      scenario: scenario.name,
      harness: harness.id,
      runId,
      state: 'refused',
      calls,
      commits: [],
      approvals: [],
      questions: [],
      failures,
      passed: false,
    };
  }
  // The person's side: each question gets the next answer, and one past the last cancels.
  const questions: string[] = [];
  for await (const event of supervisor.events(runId))
    if (event.type === 'question' && event.requestId) {
      const answer = scenario.answers?.[questions.length];
      questions.push(event.message ?? '');
      if (answer === undefined) await supervisor.cancel(runId);
      else await supervisor.respondQuestion(runId, event.requestId, answer);
    }
  const snapshot = await supervisor.get(runId);
  const state = snapshot?.state ?? 'lost';
  const judged = judge(scenario, state, calls, questions, snapshot?.failure);
  const failures = [...judged.failures];
  const partial = {
    scenario: scenario.name,
    harness: harness.id,
    runId,
    state,
    ...(snapshot?.model ? { model: snapshot.model } : {}),
    calls,
    questions,
  };
  if (scenario.check)
    try {
      await scenario.check(
        { ...partial, ...judged, failures, passed: failures.length === 0 },
        application,
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  return {
    ...partial,
    commits: judged.commits,
    approvals: judged.approvals,
    failures,
    passed: !failures.length,
  };
}

/** Run scenarios one after another, each against the application as the previous left it. */
export async function runAgentScenarios(
  scenarios: readonly AgentScenario[],
  options: RunAgentScenarioOptions,
): Promise<AgentScenarioResult[]> {
  const results: AgentScenarioResult[] = [];
  for (const scenario of scenarios) results.push(await runAgentScenario(scenario, options));
  return results;
}

/** Throw with every failure of every result, for a test. */
export function assertAgentScenarios(results: readonly AgentScenarioResult[]): void {
  const failed = results.filter((result) => !result.passed);
  if (failed.length)
    throw new Error(
      failed
        .map(
          (result) => `${result.scenario} (${result.harness}):\n  ${result.failures.join('\n  ')}`,
        )
        .join('\n'),
    );
}

/**
 * Scenarios a candidate fails that a baseline passes, by name: what a model replacing another
 * must not regress on.
 */
export function scenarioRegressions(
  candidate: readonly AgentScenarioResult[],
  baseline: readonly AgentScenarioResult[],
): string[] {
  const passed = new Set(
    baseline.filter((result) => result.passed).map((result) => result.scenario),
  );
  return candidate
    .filter((result) => !result.passed && passed.has(result.scenario))
    .map((result) => result.scenario);
}

/** Whether the person running the tests asked for a configured model: `AGENT_SCENARIOS=live`. */
export function liveScenariosRequested(env: Record<string, string | undefined> = process.env) {
  return env.AGENT_SCENARIOS === 'live';
}

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The harness agent scenarios run on: the deterministic harness, which plays each scenario's
 * script, or with `AGENT_SCENARIOS=live` a model on an OpenAI-compatible server the person
 * started on this machine (llama.cpp `llama-server`, Ollama, vLLM): `AGENT_SCENARIOS_URL`, such
 * as `http://127.0.0.1:8080/`, and the model ID it lists, `AGENT_SCENARIOS_MODEL`. It sends no
 * key and reaches no other address. A live request without both throws, so it never passes on
 * the script.
 */
export function scenarioHarness(env: Record<string, string | undefined> = process.env): Harness {
  if (!liveScenariosRequested(env)) return deterministicHarness;
  const { AGENT_SCENARIOS_URL: address, AGENT_SCENARIOS_MODEL: model } = env;
  if (!address || !model)
    throw new Error('AGENT_SCENARIOS=live needs AGENT_SCENARIOS_URL and AGENT_SCENARIOS_MODEL');
  const base = new URL(address);
  if (!loopback.has(base.hostname))
    throw new Error('AGENT_SCENARIOS_URL must be a loopback address');
  return localHarness({
    model,
    client: () => ({ fetch: (path, init) => fetch(new URL(path, base), init) }),
  });
}

/** How long a scenario test may take: a model takes minutes per scenario, a script moments. */
export const scenarioTimeout = (env: Record<string, string | undefined> = process.env) =>
  liveScenariosRequested(env) ? 15 * 60_000 : undefined;
