import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { modelPrompt, toolName } from './types';
import {
  AsyncChannel,
  StdioJsonRpc,
  executableAvailable,
  protocolRecord,
  type RpcMessage,
} from './process';

export interface CodexOptions {
  executable: string;
  cwd: string;
  home: string;
  /** Explicit host-selected credentials/provider environment. No ambient inheritance. */
  environment: Record<string, string>;
  model?: string;
  modelProvider?: string;
  providerConfig?: Record<string, unknown>;
  startupConfig?: Record<string, string | number | boolean>;
  clientInfo?: { name: string; title: string; version: string };
  turnTimeoutMs?: number;
  /** Protocol fixture seam; production uses the bundled native executable. */
  createRpc?: () => StdioJsonRpc;
}
function nativeId(response: unknown, key: 'thread' | 'turn'): string {
  const envelope = protocolRecord(response, `${key} response`);
  const record = protocolRecord(envelope[key], key);
  if (typeof record.id !== 'string' || !record.id || record.id.length > 256)
    throw new Error(`Codex did not return a valid ${key} ID`);
  return record.id;
}

/** Native app-server adapter. Dynamic tools use the documented experimental API,
 * so the native runtime version is pinned and protocol compatibility is tested. */
export class CodexHarness implements Harness {
  readonly id = 'codex';
  readonly features = { questions: true, approvals: false, resume: true };
  constructor(private readonly options: CodexOptions) {}
  availability() {
    return executableAvailable(this.options.executable);
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const definitions = turn.tools.definitions;
    if (!definitions?.length) throw new Error('Codex harness requires catalog tool definitions');
    const tools = new Map(
      definitions.map((definition) => [toolName(definition.operation), definition]),
    );
    const rpc =
      this.options.createRpc?.() ??
      new StdioJsonRpc({
        executable: this.options.executable,
        args: [
          'app-server',
          '--listen',
          'stdio://',
          ...Object.entries(this.options.startupConfig ?? {}).flatMap(([key, value]) => {
            if (!/^[a-zA-Z0-9_.-]+$/.test(key))
              throw new Error('Invalid trusted Codex configuration key');
            return ['-c', `${key}=${JSON.stringify(value)}`];
          }),
        ],
        cwd: this.options.cwd,
        env: {
          ...this.options.environment,
          HOME: this.options.home,
          USERPROFILE: this.options.home,
          CODEX_HOME: this.options.home,
        },
      });
    const channel = new AsyncChannel<HarnessEvent>();
    const completedCalls = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
    let threadId: string | undefined;
    let turnId: string | undefined;
    rpc.onFailure = (error) => channel.end(error);
    const handle = async (message: RpcMessage) => {
      const params =
        message.params === undefined
          ? {}
          : protocolRecord(message.params, 'notification parameters');
      if (message.id !== undefined && message.method) {
        if (message.method === 'item/tool/call') {
          const definition = typeof params.tool === 'string' ? tools.get(params.tool) : undefined;
          if (!definition || params.namespace || typeof params.callId !== 'string') {
            rpc.respond(message.id, {
              success: false,
              contentItems: [{ type: 'inputText', text: 'Unknown application tool' }],
            });
            return;
          }
          if (
            !params.callId ||
            params.callId.length > 256 ||
            !params.arguments ||
            typeof params.arguments !== 'object' ||
            Array.isArray(params.arguments)
          )
            throw new Error('Malformed native tool envelope');
          turn.signal.throwIfAborted();
          let call = completedCalls.get(params.callId);
          const fingerprint = JSON.stringify([definition.operation, params.arguments]);
          if (call && call.fingerprint !== fingerprint)
            throw new Error('Native tool call ID reused with different arguments');
          if (!call) {
            channel.push({
              type: 'tool-start',
              operation: definition.operation,
              callId: params.callId,
            });
            const result = turn.tools.execute(definition.operation, params.arguments, {
              runId: turn.runId,
              signal: turn.signal,
              idempotencyKey: params.callId,
            });
            call = { fingerprint, result };
            completedCalls.set(params.callId, call);
          }
          try {
            const value = await call.result;
            turn.signal.throwIfAborted();
            rpc.respond(message.id, {
              success: true,
              contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
            });
            channel.push({
              type: 'tool-finish',
              operation: definition.operation,
              callId: params.callId,
            });
          } catch {
            rpc.respond(message.id, {
              success: false,
              contentItems: [
                { type: 'inputText', text: 'Application tool was rejected or failed' },
              ],
            });
          }
        } else if (message.method === 'item/tool/requestUserInput') {
          const answers: Record<string, { answers: string[] }> = {};
          if (!Array.isArray(params.questions) || params.questions.length > 16)
            throw new Error('Malformed native questions');
          for (const raw of params.questions) {
            const question = protocolRecord(raw, 'question');
            if (typeof question.id !== 'string' || typeof question.question !== 'string')
              throw new Error('Malformed native question');
            if (question.options !== undefined && !Array.isArray(question.options))
              throw new Error('Malformed native question options');
            const choices = Array.isArray(question.options)
              ? question.options.map((raw) => {
                  const option = protocolRecord(raw, 'question option');
                  if (typeof option.label !== 'string')
                    throw new Error('Malformed native question option label');
                  return option.label;
                })
              : undefined;
            answers[question.id] = { answers: [await turn.question(question.question, choices)] };
          }
          rpc.respond(message.id, { answers });
        } else if (
          message.method === 'item/commandExecution/requestApproval' ||
          message.method === 'item/fileChange/requestApproval'
        ) {
          // This profile never elevates shell/filesystem actions through an approval.
          rpc.respond(message.id, { decision: 'decline' });
        } else rpc.reject(message.id, 'Unsupported request in application-only tool profile');
      } else if (message.method === 'item/agentMessage/delta') {
        if (typeof params.delta !== 'string') throw new Error('Malformed native text delta');
        channel.push({ type: 'text', text: params.delta });
      } else if (message.method === 'turn/completed') {
        if (typeof params.threadId !== 'string')
          throw new Error('Malformed native completion thread ID');
        if (threadId && params.threadId !== threadId) return;
        const nativeTurn = protocolRecord(params.turn, 'turn completion');
        if (typeof nativeTurn.id !== 'string' || !nativeTurn.id || nativeTurn.id.length > 256)
          throw new Error('Malformed native completion turn ID');
        if (turnId && nativeTurn.id !== turnId) return;
        if (nativeTurn.status === 'completed') channel.end();
        else if (typeof nativeTurn.status !== 'string')
          throw new Error('Malformed native turn status');
        else channel.end(new Error(`Codex turn ended with status: ${nativeTurn.status}`));
      } else if (message.method === 'error')
        channel.end(new Error('Codex reported a provider/protocol error'));
    };
    rpc.onMessage = (message) => {
      handle(message).catch((error) =>
        channel.end(error instanceof Error ? error : new Error('Native callback failed')),
      );
    };
    const cancel = () => {
      if (threadId && turnId) rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {});
      channel.end(new Error('Codex turn cancelled'));
      rpc.close();
    };
    const timeout = setTimeout(() => {
      channel.end(new Error('Codex turn timed out'));
      rpc.close();
    }, this.options.turnTimeoutMs ?? 300_000);
    turn.signal.addEventListener('abort', cancel, { once: true });
    try {
      turn.signal.throwIfAborted();
      await rpc.request('initialize', {
        clientInfo: this.options.clientInfo ?? {
          name: 'agent-native-starter',
          title: 'Application workspace',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true },
      });
      rpc.notify('initialized');
      const config = {
        ...this.options.providerConfig,
        'features.shell_tool': false,
        'features.apply_patch_freeform': false,
        'features.js_repl': false,
        'features.web_search_request': false,
      };
      const thread = turn.resumeData?.threadId
        ? await rpc.request('thread/resume', {
            threadId: turn.resumeData.threadId,
            cwd: this.options.cwd,
            config,
          })
        : await rpc.request('thread/start', {
            cwd: this.options.cwd,
            model: this.options.model,
            modelProvider: this.options.modelProvider,
            sandbox: 'read-only',
            approvalPolicy: 'never',
            config,
            dynamicTools: definitions.map((definition) => ({
              type: 'function',
              name: toolName(definition.operation),
              description: definition.description,
              inputSchema: definition.inputSchema,
            })),
            developerInstructions:
              'Use only the application tools supplied by this host. Do not access shell or files. Application tool results are the authority for business changes.',
          });
      threadId = nativeId(thread, 'thread');
      yield { type: 'resume-data', data: { threadId } };
      const started = await rpc.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: modelPrompt(turn), textElements: [] }],
      });
      turnId = nativeId(started, 'turn');
      for await (const event of channel) {
        turn.signal.throwIfAborted();
        yield event;
      }
    } finally {
      clearTimeout(timeout);
      turn.signal.removeEventListener('abort', cancel);
      rpc.close();
    }
  }
}

/** Explicit ChatGPT plan profile. ACCESS_TOKEN is injected into this child only.
 * Recreate the harness after token refresh and resume the recorded native thread. */
export function chatGptCodexOptions(
  accessToken: string,
  appName: string,
): Pick<CodexOptions, 'environment' | 'modelProvider' | 'startupConfig' | 'clientInfo'> {
  if (!accessToken || !appName.trim())
    throw new Error('ChatGPT access token and stable application name required');
  return {
    environment: { ACCESS_TOKEN: accessToken },
    modelProvider: 'openai_chatgpt_plan',
    clientInfo: { name: appName, title: appName, version: '0.1.0' },
    startupConfig: {
      model_provider: 'openai_chatgpt_plan',
      'model_providers.openai_chatgpt_plan.name': 'ChatGPT plan',
      'model_providers.openai_chatgpt_plan.base_url': 'https://api.openai.com/v1',
      'model_providers.openai_chatgpt_plan.env_key': 'ACCESS_TOKEN',
      'model_providers.openai_chatgpt_plan.wire_api': 'responses',
      'model_providers.openai_chatgpt_plan.requires_openai_auth': false,
      'model_providers.openai_chatgpt_plan.supports_websockets': false,
    },
  };
}
