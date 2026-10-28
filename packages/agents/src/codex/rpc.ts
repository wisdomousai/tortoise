import { StdioJsonRpc, protocolRecord } from '../process';
import type { ToolDefinition } from '../types';
import { toolDescription, toolName } from '../types';
import type { CodexOptions } from '../codex';

/** The app-server child: trusted startup configuration only, HOME pinned to the run's home. */
export function createCodexRpc(options: CodexOptions): StdioJsonRpc {
  return (
    options.createRpc?.() ??
    new StdioJsonRpc({
      executable: options.executable,
      args: [
        'app-server',
        '--listen',
        'stdio://',
        ...Object.entries(options.startupConfig ?? {}).flatMap(([key, value]) => {
          if (!/^[a-zA-Z0-9_.-]+$/.test(key))
            throw new Error('Invalid trusted Codex configuration key');
          return ['-c', `${key}=${JSON.stringify(value)}`];
        }),
      ],
      cwd: options.cwd,
      env: {
        ...options.environment,
        HOME: options.home,
        USERPROFILE: options.home,
        CODEX_HOME: options.home,
      },
    })
  );
}

export function nativeId(response: unknown, key: 'thread' | 'turn'): string {
  const envelope = protocolRecord(response, `${key} response`);
  const record = protocolRecord(envelope[key], key);
  if (typeof record.id !== 'string' || !record.id || record.id.length > 256)
    throw new Error(`Codex did not return a valid ${key} ID`);
  return record.id;
}

/**
 * Initialize the protocol and start or resume the thread with shell, patch, REPL and web search
 * disabled. A new thread gets only the application's tools.
 */
export async function openThread(
  rpc: StdioJsonRpc,
  options: CodexOptions,
  definitions: readonly ToolDefinition[],
  resumeThreadId: string | undefined,
): Promise<string> {
  await rpc.request('initialize', {
    clientInfo: options.clientInfo ?? {
      name: 'agent-native-starter',
      title: 'Application workspace',
      version: '0.1.0',
    },
    capabilities: { experimentalApi: true },
  });
  rpc.notify('initialized');
  const config = {
    ...options.providerConfig,
    'features.shell_tool': false,
    'features.apply_patch_freeform': false,
    'features.js_repl': false,
    'features.web_search_request': false,
  };
  const thread = resumeThreadId
    ? await rpc.request('thread/resume', { threadId: resumeThreadId, cwd: options.cwd, config })
    : await rpc.request('thread/start', {
        cwd: options.cwd,
        model: options.model,
        modelProvider: options.modelProvider,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        config,
        dynamicTools: definitions.map((definition) => ({
          type: 'function',
          name: toolName(definition.operation),
          description: toolDescription(definition),
          inputSchema: definition.inputSchema,
        })),
        developerInstructions:
          'Use only the application tools supplied by this host. Do not access shell or files. Application tool results are the instance for business changes.',
      });
  return nativeId(thread, 'thread');
}
