/**
 * Agent definitions are catalog metadata: what an agent is for, which operations it may call and
 * how far a run may go. They hold no model credentials, prompts from people or permissions of
 * their own. A run under a definition still executes as the person or standing grant that
 * started it, narrowed to the definition's operations, and every call is authorized by the
 * application policy like any other caller's.
 */

/** Where the model may run: on this host (`local`), at a provider (`remote`), or either. */
export type ModelRequirement = 'local' | 'remote' | 'any';

/**
 * `direct`: the agent runs its commands itself, so each one must have a UI binding a person can
 * use to see and repeat the change. `request-approval`: the agent's commands become approval requests a person
 * or allowed caller approves with their own grants and policy; it runs queries directly.
 */
export type AgentOutput = 'direct' | 'request-approval';

export interface AgentBudgets {
  /** Model turns per run; adapters that count turns stop there. */
  readonly turns: number;
  /** Application tool calls per run, enforced by the run supervisor. */
  readonly toolCalls: number;
  /** Wall-clock time per run in milliseconds, enforced by the run supervisor. */
  readonly wallTimeMs: number;
}

export interface AgentDefinition<Ops extends readonly string[] = readonly string[]> {
  /** Lowercase dotted or dashed ID, unique across the catalog, for example `stop.classifier`. */
  readonly id: string;
  /** Short name for menus and run lists. */
  readonly title: string;
  /** What the agent does, when to use it and what it must not do. Read as the system prompt. */
  readonly instructions: string;
  /** Operations the agent may call; its grant never includes more. */
  readonly operations: Ops;
  /**
   * Resource types a run is scoped to, for example `['lot']`. A run's grant then lists only the
   * resources of these types it was started on (the person's selection or the trigger's
   * resource), so rules that check grant resources refuse everything else. Omitted: the run is
   * not resource-scoped and the operations' own authorization applies.
   */
  readonly resourceTypes?: readonly string[];
  readonly model: ModelRequirement;
  /**
   * Model entries this agent may run on, by ID, for a `local` agent that needs a particular base
   * model or fine-tune rather than any local model. A harness serving another entry, or none, is
   * refused. Omitted: any harness that meets `model`.
   */
  readonly models?: readonly string[];
  readonly output: AgentOutput;
  readonly budgets: AgentBudgets;
}

/** Declare an agent on a module. Operation IDs keep their literal types for checking. */
export function defineAgent<const Ops extends readonly string[]>(
  agent: AgentDefinition<Ops>,
): AgentDefinition<Ops> {
  return Object.freeze({ ...agent, operations: Object.freeze([...agent.operations]) as Ops });
}

/** The catalog's view of an agent: its definition and the module that declares it. */
export interface CatalogAgent extends AgentDefinition {
  readonly module: string;
}

/** Operation facts the agent checks need; a subset of the catalog operation. */
export interface AgentOperationFacts {
  readonly id: string;
  readonly kind: 'command' | 'query';
  readonly ui: { readonly binding?: string; readonly exception?: string };
}

const AGENT_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_WALL_TIME_MS = 24 * 60 * 60 * 1000;

function checkBudgets(agent: AgentDefinition): void {
  const { turns, toolCalls, wallTimeMs } = agent.budgets ?? ({} as AgentBudgets);
  for (const [name, value, max] of [
    ['turns', turns, 1000],
    ['toolCalls', toolCalls, 10_000],
    ['wallTimeMs', wallTimeMs, MAX_WALL_TIME_MS],
  ] as const)
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Agent ${agent.id} budget ${name} must be an integer from 1 to ${max}`);
}

/**
 * Validate one agent against the catalog's operations: a well-formed unique ID, known
 * operations, bounded budgets, and for a `direct` agent a UI binding on every command it may run.
 */
export function checkAgent(
  agent: AgentDefinition,
  operations: ReadonlyMap<string, AgentOperationFacts>,
): void {
  if (!AGENT_ID.test(agent.id) || agent.id.length > 64)
    throw new Error(`Invalid agent ID: ${agent.id}`);
  if (!agent.title?.trim() || !agent.instructions?.trim())
    throw new Error(`Agent ${agent.id} needs a title and instructions`);
  if (!['local', 'remote', 'any'].includes(agent.model))
    throw new Error(`Agent ${agent.id} model must be local, remote or any`);
  if (agent.models !== undefined) {
    if (agent.model !== 'local')
      throw new Error(`Agent ${agent.id} names models, so its model requirement must be local`);
    if (!agent.models.length || agent.models.some((id) => !AGENT_ID.test(id) || id.length > 64))
      throw new Error(`Agent ${agent.id} models must be model entry IDs`);
  }
  if (!['direct', 'request-approval'].includes(agent.output))
    throw new Error(`Agent ${agent.id} output must be direct or request-approval`);
  if (agent.operations.length === 0) throw new Error(`Agent ${agent.id} has no operations`);
  if (new Set(agent.operations).size !== agent.operations.length)
    throw new Error(`Agent ${agent.id} lists an operation twice`);
  for (const id of agent.operations) {
    const operation = operations.get(id);
    if (!operation) throw new Error(`Agent ${agent.id} references unknown operation ${id}`);
    // A direct write must be one a person can make and see through a screen.
    if (agent.output === 'direct' && operation.kind === 'command' && !operation.ui.binding)
      throw new Error(`Direct agent ${agent.id} runs ${id}, which has no UI binding`);
  }
  for (const type of agent.resourceTypes ?? [])
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(type))
      throw new Error(`Agent ${agent.id} resource type ${type} is not a resource type name`);
  checkBudgets(agent);
}

/** Every module's agents, validated against the operations and sorted by ID. */
export function catalogAgents(
  modules: readonly { readonly id: string; readonly agents?: readonly AgentDefinition[] }[],
  operations: ReadonlyMap<string, AgentOperationFacts>,
): CatalogAgent[] {
  const ids = new Set<string>();
  const agents: CatalogAgent[] = [];
  for (const module of modules)
    for (const agent of module.agents ?? []) {
      if (ids.has(agent.id)) throw new Error(`Duplicate agent: ${agent.id}`);
      ids.add(agent.id);
      checkAgent(agent, operations);
      agents.push({ ...agent, module: module.id });
    }
  return agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
