/** Host-owned application tools. Implementations derive identity/grants from the run,
 * never from model arguments, and recheck cancellation at their commit boundary. */
export interface ToolPort {
  readonly definitions?: readonly ToolDefinition[];
  /**
   * The tools one run sees, from the context the host captured when it started, such as tools
   * that exist only for a run started from a UI selection. Absent: `definitions`.
   */
  definitionsFor?(context: Readonly<Record<string, unknown>>): readonly ToolDefinition[];
  execute(operation: string, input: unknown, context: ToolExecutionContext): Promise<unknown>;
}
export interface ToolDefinition {
  operation: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ToolExecutionContext {
  runId: string;
  signal: AbortSignal;
  /** Stable per invocation, including a repeated native tool callback. */
  idempotencyKey?: string;
}
export type RunState =
  | 'queued'
  | 'running'
  | 'awaiting-question'
  | 'awaiting-approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type HarnessEvent =
  | { type: 'text'; text: string }
  | { type: 'progress'; message: string }
  | { type: 'tool-start'; operation: string; callId: string }
  | { type: 'tool-finish'; operation: string; callId: string }
  | { type: 'resume-data'; data: Record<string, string> };
export interface RunEvent {
  sequence: number;
  at: string;
  /** `answer`: the person's response to the question or approval `requestId` names. */
  type: HarnessEvent['type'] | 'state' | 'question' | 'approval' | 'answer';
  state?: RunState;
  text?: string;
  message?: string;
  operation?: string;
  callId?: string;
  /**
   * On `tool-finish`: the records the command changed (`<kind>:<id>`, from its command result's
   * revisions), so a run view can link a call to its record.
   */
  resources?: readonly string[];
  /** On `tool-finish`: the error code when the application refused the call. */
  code?: string;
  requestId?: string;
  choices?: readonly string[];
  /** On `answer` to an approval: whether the person approved. A question's answer is `text`. */
  approved?: boolean;
}
export interface RunSnapshot {
  id: string;
  harnessId: string;
  conversationId: string;
  state: RunState;
  createdAt: string;
  updatedAt: string;
  /** Captured, server-approved UI/resource context; later selections cannot retarget it. */
  context: Record<string, unknown>;
  /**
   * What the person asked, scrubbed like event text, so a conversation shows it after a reload.
   * The prompt the harness read also held the agent's instructions; the run keeps only this.
   */
  request?: string;
  events: RunEvent[];
  nextSequence: number;
  resumeData?: Record<string, string>;
  /** Limits from the agent definition the run was started under; the supervisor enforces them. */
  budget?: RunBudget;
  /** The harness's model when the run started, if it declares one. */
  model?: ModelIdentity;
  failure?: { code: string; message: string };
}
/**
 * Per-run limits. The supervisor fails a run with `BUDGET_EXCEEDED` when it would make one tool
 * call more than `toolCalls` or runs past `wallTimeMs`. `turns` is passed to the harness, and
 * adapters that count model turns stop there.
 */
export interface RunBudget {
  turns?: number;
  toolCalls?: number;
  wallTimeMs?: number;
}
/**
 * Persist atomically per snapshot. Stores must not contain credentials or the prompt a harness
 * reads; they hold the person's scrubbed request.
 */
export interface RunStore {
  get(id: string): Promise<RunSnapshot | undefined>;
  list(): Promise<RunSnapshot[]>;
  save(snapshot: RunSnapshot): Promise<void>;
}
export interface HarnessTurn {
  runId: string;
  conversationId: string;
  prompt: string;
  context: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
  tools: ToolPort;
  resumeData?: Record<string, string>;
  /**
   * The conversation's earlier turns, oldest first, for a harness that cannot resume a native
   * session (`features.resume` false). A harness that resumes gets none.
   */
  earlier?: readonly ConversationTurn[];
  budget?: RunBudget;
  question(message: string, choices?: readonly string[]): Promise<string>;
  approve(message: string): Promise<boolean>;
}
/** One earlier run of a conversation: what the person asked and the text the agent replied. */
export interface ConversationTurn {
  readonly request: string;
  readonly reply: string;
}
/**
 * Where a harness sends prompts. `local`: a model on this host, over a loopback destination.
 * `remote`: a model provider. `none`: no model at all (scripted fixtures, jobs), so nothing
 * leaves the host. A harness that does not say is treated as remote.
 */
export type HarnessInference = 'local' | 'remote' | 'none';

/**
 * The model a harness runs, recorded on each run so its work names the model that did it. With
 * a model entry, the digests trace an approval request back through its run to the weights, the adapter
 * and the dataset the adapter was tuned on.
 */
export interface ModelIdentity {
  readonly provider: string;
  readonly model: string;
  /** Content digest of the base weights. */
  readonly digest?: string;
  /** The model entry the harness serves, by ID. */
  readonly entry?: string;
  /** Content digest of the adapter or merged fine-tune, when the entry has one. */
  readonly adapterDigest?: string;
  /** Digest of the dataset the adapter was trained on, as its entry states it. */
  readonly datasetDigest?: string;
  /**
   * True when the host hashed the files it started the server with and they matched; false or
   * absent when the digests are only what the deployment typed in.
   */
  readonly verified?: boolean;
}

export interface Harness {
  readonly id: string;
  readonly features: { questions: boolean; approvals: boolean; resume: boolean };
  readonly inference?: HarnessInference;
  readonly model?: ModelIdentity;
  /** Agents the harness's model entry admits, by ID; omitted admits every agent. */
  readonly agents?: readonly string[];
  availability(): Promise<{ available: boolean; reason?: string }>;
  run(turn: HarnessTurn): AsyncIterable<HarnessEvent>;
}
export const terminalStates = new Set<RunState>([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);

/**
 * The text a provider adapter sends to its model: the user's prompt plus the selection the host
 * captured from their screen when the run started. Only resource references and the revisions the
 * user saw leave the run context; identity, grant, provider selection and the UI session ID stay
 * with the host. The host validated each reference with an authorized query at capture, and the
 * model reads contents only through application tools, which authorize at call time. A run
 * started from a UI session also learns that the `ui.*` tools reach that screen. A context
 * without a UI session adds nothing.
 */
export function modelPrompt(turn: Pick<HarnessTurn, 'prompt' | 'context'>): string {
  const ui = turn.context.uiContext as
    { sessionId?: unknown; selectedResources?: unknown; observedRevisions?: unknown } | undefined;
  const screen =
    typeof ui?.sessionId === 'string'
      ? '\n\nThis request was made from an application screen. ui.open and ui.select show a resource there, ui.prepare fills a command’s form there for the person to check and submit, and ui.request-review asks the person to review records such as your approval requests; they change no records.'
      : '';
  const selected = Array.isArray(ui?.selectedResources)
    ? ui.selectedResources.filter((resource): resource is string => typeof resource === 'string')
    : [];
  if (!selected.length) return `${turn.prompt}${screen}`;
  const revisions = (
    typeof ui?.observedRevisions === 'object' && ui.observedRevisions !== null
      ? ui.observedRevisions
      : {}
  ) as Record<string, unknown>;
  const lines = selected.map((resource) => {
    const revision = revisions[resource];
    return typeof revision === 'number' ? `- ${resource} (revision ${revision})` : `- ${resource}`;
  });
  return `${turn.prompt}\n\nSelected in the application when this request was made (read them with the application tools before acting; they may have changed since):\n${lines.join('\n')}${screen}`;
}

/** Native providers have tighter naming rules than capability IDs. The hexadecimal
 * encoding is reversible and collision-free, unlike replacing punctuation. */
export function toolName(operation: string): string {
  const name = `app_${Buffer.from(operation, 'utf8').toString('hex')}`;
  if (name.length > 64)
    throw new Error(`Capability ID is too long for provider tool naming: ${operation}`);
  return name;
}

/** The provider tool description. It starts with the capability ID, because the encoded tool name
 * hides it and an agent's instructions name capabilities by ID. */
export function toolDescription(definition: { operation: string; description: string }): string {
  return definition.description === definition.operation
    ? definition.operation
    : `${definition.operation}: ${definition.description}`;
}
