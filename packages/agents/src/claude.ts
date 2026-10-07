import {
  query,
  createSdkMcpServer,
  tool,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { modelPrompt, toolName } from './types';
import { spawn } from 'node:child_process';
import { executableAvailable, nativeEnvironment, terminateProcessTree } from './process';

type QueryFactory = typeof query;
export class ClaudeHarness implements Harness {
  readonly id = 'claude';
  readonly features = { questions: false, approvals: false, resume: true };
  constructor(
    private readonly options: {
      executable: string;
      cwd: string;
      home: string;
      apiKey: string;
      model?: string;
      maxTurns?: number;
      query?: QueryFactory;
      /** Host-supplied variables, e.g. the egress proxy for this declared process. */
      environment?: Record<string, string>;
    },
  ) {}
  async availability() {
    if (!this.options.apiKey)
      return { available: false, reason: 'Explicit Claude API credentials are required' };
    return executableAvailable(this.options.executable);
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const definitions = turn.tools.definitions;
    if (!definitions?.length) throw new Error('Claude harness requires catalog tool definitions');
    // JSON Schema validation remains authoritative in the application runtime. Zod's
    // JSON Schema converter preserves catalog validation for the provider tool schema.
    const server = createSdkMcpServer({
      name: 'application',
      version: '1.0.0',
      tools: definitions.map((definition) => {
        const schema = z.fromJSONSchema(definition.inputSchema) as z.ZodObject;
        if (!('shape' in schema))
          throw new Error('Application tool input schema must describe an object');
        return tool(
          toolName(definition.operation),
          definition.description,
          schema.shape,
          async (input, extra) => {
            turn.signal.throwIfAborted();
            const requestId = (extra as Record<string, unknown> | undefined)?.requestId;
            const callId = typeof requestId === 'string' ? requestId : crypto.randomUUID();
            const result = await turn.tools.execute(definition.operation, input, {
              runId: turn.runId,
              signal: turn.signal,
              idempotencyKey: callId,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          },
        );
      }),
    });
    const controller = new AbortController();
    const cancel = () => controller.abort(turn.signal.reason);
    turn.signal.addEventListener('abort', cancel, { once: true });
    if (turn.signal.aborted) cancel();
    const options: Options = {
      pathToClaudeCodeExecutable: this.options.executable,
      cwd: this.options.cwd,
      abortController: controller,
      env: nativeEnvironment({
        ...this.options.environment,
        HOME: this.options.home,
        USERPROFILE: this.options.home,
        CLAUDE_CONFIG_DIR: this.options.home,
        ANTHROPIC_API_KEY: this.options.apiKey,
      }),
      model: this.options.model,
      maxTurns: this.options.maxTurns ?? 12,
      tools: [],
      allowedTools: definitions.map(
        (definition) => `mcp__application__${toolName(definition.operation)}`,
      ),
      mcpServers: { application: server },
      strictMcpConfig: true,
      settingSources: [],
      persistSession: true,
      resume: turn.resumeData?.sessionId,
      canUseTool: async (name, input) =>
        definitions.some(
          (definition) => name === `mcp__application__${toolName(definition.operation)}`,
        )
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: `Tool outside the application profile: ${name}` },
      includePartialMessages: true,
      // SDK forwards its signal after its stdin-EOF grace window. Retain that
      // lifecycle while extending termination to this host's isolated child tree.
      spawnClaudeCodeProcess: (spawnOptions) => {
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
      },
    };
    let complete = false;
    const messages = (this.options.query ?? query)({ prompt: modelPrompt(turn), options });
    try {
      for await (const message of messages) {
        turn.signal.throwIfAborted();
        if (message.type === 'system' && message.subtype === 'init')
          yield { type: 'resume-data', data: { sessionId: message.session_id } };
        else if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
            yield { type: 'text', text: event.delta.text };
        } else if (message.type === 'result') {
          complete = true;
          if (message.subtype !== 'success' || message.is_error)
            throw new Error(`Claude turn failed: ${message.subtype}`);
        }
      }
      if (!complete) throw new Error('Claude stream ended without a terminal result');
    } finally {
      turn.signal.removeEventListener('abort', cancel);
      messages.close();
    }
  }
}
