import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Harness, HarnessEvent, HarnessTurn, ToolDefinition } from './types';
import { modelPrompt } from './types';
import { spawn } from 'node:child_process';
import { executableAvailable, nativeEnvironment, terminateProcessTree } from './process';
import { applicationMcpServer, applicationToolName } from './claude/tools';

type QueryFactory = typeof query;
type ClaudeOptions = {
  executable: string;
  cwd: string;
  home: string;
  apiKey: string;
  model?: string;
  maxTurns?: number;
  query?: QueryFactory;
  /** Host-supplied variables, e.g. the egress proxy for this declared process. */
  environment?: Record<string, string>;
};

/**
 * The SDK forwards its signal after its stdin-EOF grace window. Retain that lifecycle while
 * extending termination to this host's isolated child tree.
 */
const spawnClaudeCodeProcess: Options['spawnClaudeCodeProcess'] = (spawnOptions) => {
  const child = spawn(spawnOptions.command, spawnOptions.args, {
    cwd: spawnOptions.cwd,
    env: spawnOptions.env,
    stdio: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.stderr.resume();
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    terminateProcessTree(child, signal === 'SIGKILL');
    return true;
  };
  const abort = () => {
    stop();
  };
  spawnOptions.signal.addEventListener('abort', abort, { once: true });
  child.once('exit', () => spawnOptions.signal.removeEventListener('abort', abort));
  if (spawnOptions.signal.aborted) abort();
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    kill: stop,
    on: child.on.bind(child),
    once: child.once.bind(child),
    off: child.off.bind(child),
  };
};

/** SDK options: only the application's tools, no settings sources, HOME pinned per run. */
function sdkOptions(
  options: ClaudeOptions,
  turn: HarnessTurn,
  definitions: readonly ToolDefinition[],
  application: ReturnType<typeof applicationMcpServer>,
  controller: AbortController,
): Options {
  return {
    pathToClaudeCodeExecutable: options.executable,
    cwd: options.cwd,
    abortController: controller,
    env: nativeEnvironment({
      ...options.environment,
      HOME: options.home,
      USERPROFILE: options.home,
      CLAUDE_CONFIG_DIR: options.home,
      ANTHROPIC_API_KEY: options.apiKey,
    }),
    model: options.model,
    // A run budget can only lower the configured limit.
    maxTurns: Math.min(options.maxTurns ?? 12, turn.budget?.turns ?? Infinity),
    tools: [],
    allowedTools: definitions.map(applicationToolName),
    mcpServers: { application },
    strictMcpConfig: true,
    settingSources: [],
    persistSession: true,
    resume: turn.resumeData?.sessionId,
    canUseTool: async (name, input) =>
      definitions.some((definition) => name === applicationToolName(definition))
        ? { behavior: 'allow' as const, updatedInput: input }
        : { behavior: 'deny' as const, message: `Tool outside the application profile: ${name}` },
    includePartialMessages: true,
    spawnClaudeCodeProcess,
  };
}

/** The harness events one SDK message carries; a result message reports completion. */
function translate(message: SDKMessage): { events: HarnessEvent[]; complete?: true } {
  if (message.type === 'system' && message.subtype === 'init')
    return { events: [{ type: 'resume-data', data: { sessionId: message.session_id } }] };
  if (message.type === 'stream_event') {
    const event = message.event;
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
      return { events: [{ type: 'text', text: event.delta.text }] };
  } else if (message.type === 'result') {
    if (message.subtype !== 'success' || message.is_error)
      throw new Error(`Claude turn failed: ${message.subtype}`);
    return { events: [], complete: true };
  }
  return { events: [] };
}

export class ClaudeHarness implements Harness {
  readonly id = 'claude';
  readonly features = { questions: false, approvals: false, resume: true };
  constructor(private readonly options: ClaudeOptions) {}
  async availability() {
    if (!this.options.apiKey)
      return { available: false, reason: 'Explicit Claude API credentials are required' };
    return executableAvailable(this.options.executable);
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const definitions = turn.tools.definitions;
    if (!definitions?.length) throw new Error('Claude harness requires catalog tool definitions');
    const server = applicationMcpServer(turn, definitions);
    const controller = new AbortController();
    const cancel = () => controller.abort(turn.signal.reason);
    turn.signal.addEventListener('abort', cancel, { once: true });
    if (turn.signal.aborted) cancel();
    const options = sdkOptions(this.options, turn, definitions, server, controller);
    let complete = false;
    const messages = (this.options.query ?? query)({ prompt: modelPrompt(turn), options });
    try {
      for await (const message of messages) {
        turn.signal.throwIfAborted();
        const result = translate(message);
        if (result.complete) complete = true;
        yield* result.events;
      }
      if (!complete) throw new Error('Claude stream ended without a terminal result');
    } finally {
      turn.signal.removeEventListener('abort', cancel);
      messages.close();
    }
  }
}
