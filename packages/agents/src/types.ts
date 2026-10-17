/** Host-owned application tools. Implementations derive identity/grants from the run,
 * never from model arguments, and recheck cancellation at their commit boundary. */
export interface ToolPort {
  readonly definitions?: readonly ToolDefinition[];
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
  type: HarnessEvent['type'] | 'state' | 'question' | 'approval';
  state?: RunState;
  text?: string;
  message?: string;
  operation?: string;
  callId?: string;
  requestId?: string;
  choices?: readonly string[];
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
  events: RunEvent[];
  nextSequence: number;
  resumeData?: Record<string, string>;
  /** Limits from the agent definition the run was started under; the supervisor enforces them. */
  budget?: RunBudget;
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
/** Persist atomically per snapshot. Stores must not contain credentials or prompts. */
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
  budget?: RunBudget;
  question(message: string, choices?: readonly string[]): Promise<string>;
  approve(message: string): Promise<boolean>;
}
export interface Harness {
  readonly id: string;
  readonly features: { questions: boolean; approvals: boolean; resume: boolean };
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
 * model reads contents only through application tools, which authorize at call time. A context
 * without a well-formed selection adds nothing.
 */
export function modelPrompt(turn: Pick<HarnessTurn, 'prompt' | 'context'>): string {
  const ui = turn.context.uiContext as
    { selectedResources?: unknown; observedRevisions?: unknown } | undefined;
  const selected = Array.isArray(ui?.selectedResources)
    ? ui.selectedResources.filter((resource): resource is string => typeof resource === 'string')
    : [];
  if (!selected.length) return turn.prompt;
  const revisions = (
    typeof ui?.observedRevisions === 'object' && ui.observedRevisions !== null
      ? ui.observedRevisions
      : {}
  ) as Record<string, unknown>;
  const lines = selected.map((resource) => {
    const revision = revisions[resource];
    return typeof revision === 'number' ? `- ${resource} (revision ${revision})` : `- ${resource}`;
  });
  return `${turn.prompt}\n\nSelected in the application when this request was made (read them with the application tools before acting; they may have changed since):\n${lines.join('\n')}`;
}

/** Native providers have tighter naming rules than capability IDs. The hexadecimal
 * encoding is reversible and collision-free, unlike replacing punctuation. */
export function toolName(operation: string): string {
  const name = `app_${Buffer.from(operation, 'utf8').toString('hex')}`;
  if (name.length > 64)
    throw new Error(`Capability ID is too long for provider tool naming: ${operation}`);
  return name;
}
