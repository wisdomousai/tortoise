import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { modelPrompt, toolName } from './types';
import { AsyncChannel, executableAvailable, type StdioJsonRpc } from './process';
import { handleCodexMessage, type CodexTurn } from './codex/messages';
import { createCodexRpc, nativeId, openThread } from './codex/rpc';

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

/** Native app-server adapter. Dynamic tools use the documented experimental API,
 * so the native runtime version is pinned and protocol compatibility is tested. */
export class CodexHarness implements Harness {
  readonly id = 'codex';
  readonly features = { questions: true, approvals: false, resume: true };
  readonly inference = 'remote';
  constructor(private readonly options: CodexOptions) {}
  availability() {
    return executableAvailable(this.options.executable);
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const definitions = turn.tools.definitions;
    if (!definitions?.length) throw new Error('Codex harness requires catalog tool definitions');
    const rpc = createCodexRpc(this.options);
    const channel = new AsyncChannel<HarnessEvent>();
    let threadId: string | undefined;
    let turnId: string | undefined;
    const state: CodexTurn = {
      rpc,
      channel,
      turn,
      tools: new Map(definitions.map((definition) => [toolName(definition.operation), definition])),
      completedCalls: new Map(),
      ids: () => ({ threadId, turnId }),
    };
    rpc.onFailure = (error) => channel.end(error);
    rpc.onMessage = (message) => {
      handleCodexMessage(state, message).catch((error) =>
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
      threadId = await openThread(rpc, this.options, definitions, turn.resumeData?.threadId);
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
