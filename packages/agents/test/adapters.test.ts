import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MockLanguageModelV4 } from 'ai/test';
import { ApplicationError } from '@tortoise/contracts';
import { AiSdkHarness, ASK_TOOL } from '../src/ai-sdk';
import { ClaudeHarness } from '../src/claude';
import { CodexHarness } from '../src/codex';
import { toolName, type HarnessTurn } from '../src/types';
import type { StdioJsonRpc } from '../src/process';
function turn(calls: unknown[] = []): HarnessTurn {
  return {
    runId: 'fixture-run',
    conversationId: 'fixture-conversation',
    prompt: 'Call app.ping then report done.',
    context: {},
    signal: new AbortController().signal,
    tools: {
      definitions: [
        {
          operation: 'app.ping',
          description: 'Deterministic application query',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      ],
      execute: async (...args) => {
        calls.push(args);
        return { result: 'pong' };
      },
    },
    question: async () => 'yes',
    approve: async () => false,
  };
}
async function collect(iterable: AsyncIterable<unknown>) {
  const results = [];
  for await (const item of iterable) results.push(item);
  return results;
}

describe('provider adapters with local protocol fixtures', () => {
  test('Codex dispatches application tools once, declines shell approval, records resume and requires completed status', async () => {
    const calls: unknown[] = [];
    const responses: unknown[] = [];
    const requests: unknown[] = [];
    let closed = false;
    const rpc: any = {
      request: async (method: string, params: unknown) => {
        requests.push([method, params]);
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') {
          setTimeout(() => {
            rpc.onMessage({
              id: 10,
              method: 'item/tool/call',
              params: {
                tool: toolName('app.ping'),
                callId: 'call-1',
                arguments: { message: 'hello' },
              },
            });
            rpc.onMessage({ id: 11, method: 'item/commandExecution/requestApproval', params: {} });
            setTimeout(() => {
              rpc.onMessage({
                id: 12,
                method: 'item/tool/call',
                params: {
                  tool: toolName('app.ping'),
                  callId: 'call-1',
                  arguments: { message: 'hello' },
                },
              });
              rpc.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'done' } });
              rpc.onMessage({
                method: 'turn/completed',
                params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
              });
            }, 2);
          }, 2);
          return { turn: { id: 'turn-1' } };
        }
        return {};
      },
      notify() {},
      respond: (id: number, value: unknown) => responses.push([id, value]),
      reject() {},
      close() {
        closed = true;
      },
    };
    const harness = new CodexHarness({
      executable: process.execPath,
      cwd: process.cwd(),
      home: '/unused-fixture',
      environment: {},
      createRpc: () => rpc as StdioJsonRpc,
    });
    const events: any[] = await collect(harness.run(turn(calls)));
    expect(calls.length).toBe(1);
    expect((calls[0] as any)[2].idempotencyKey).toBe('call-1');
    expect(responses).toContainEqual([11, { decision: 'decline' }]);
    expect(events).toContainEqual({ type: 'resume-data', data: { threadId: 'thread-1' } });
    expect(events).toContainEqual({ type: 'text', text: 'done' });
    expect(closed).toBe(true);
    const start: any = requests.find((request: any) => request[0] === 'thread/start');
    expect(start[1].sandbox).toBe('read-only');
    expect(start[1].approvalPolicy).toBe('never');
    // The encoded tool name hides the capability ID, so the description carries it.
    expect(start[1].dynamicTools[0].description).toBe('app.ping: Deterministic application query');
  });
  test('Codex native failure after text is still failure and process is closed', async () => {
    let closed = false;
    const rpc: any = {
      request: async (method: string) => {
        if (method === 'thread/start') return { thread: { id: 'thread' } };
        if (method === 'turn/start') {
          setTimeout(() => {
            rpc.onMessage({ method: 'item/agentMessage/delta', params: { delta: 'partial' } });
            rpc.onMessage({
              method: 'turn/completed',
              params: { threadId: 'thread', turn: { id: 'turn', status: 'failed' } },
            });
          }, 1);
          return { turn: { id: 'turn' } };
        }
        return {};
      },
      notify() {},
      close() {
        closed = true;
      },
    };
    await expect(
      collect(
        new CodexHarness({
          executable: process.execPath,
          cwd: process.cwd(),
          home: '/fixture',
          environment: {},
          createRpc: () => rpc,
        }).run(turn()),
      ),
    ).rejects.toThrow('failed');
    expect(closed).toBe(true);
  });
  test('Claude real in-process MCP server invokes shared tools and denies undeclared tools', async () => {
    const calls: unknown[] = [];
    let closed = false;
    let captured: any;
    const query: any = ({ options }: any) => {
      captured = options;
      const messages = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session' };
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'fixture', version: '1' });
        await options.mcpServers.application.instance.connect(serverTransport);
        await client.connect(clientTransport);
        const result = await client.callTool({
          name: toolName('app.ping'),
          arguments: { message: 'hello' },
        });
        expect(result.isError).not.toBe(true);
        await client.close();
        await options.mcpServers.application.instance.close();
        expect((await options.canUseTool('Bash', { command: 'bad' })).behavior).toBe('deny');
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } },
        };
        yield { type: 'result', subtype: 'success', is_error: false };
      })();
      return Object.assign(messages, {
        close() {
          closed = true;
        },
      });
    };
    const events = await collect(
      new ClaudeHarness({
        executable: process.execPath,
        cwd: process.cwd(),
        home: '/isolated',
        apiKey: 'explicit-fixture',
        query,
      }).run(turn(calls)),
    );
    expect(calls.length).toBe(1);
    expect(closed).toBe(true);
    expect(captured.tools).toEqual([]);
    expect(captured.settingSources).toEqual([]);
    expect(captured.env.ANTHROPIC_API_KEY).toBe('explicit-fixture');
    expect(events).toContainEqual({ type: 'text', text: 'done' });
  });
  test('Claude rejects a truncated stream without result', async () => {
    const query: any = () =>
      Object.assign(
        (async function* () {
          yield { type: 'system', subtype: 'init', session_id: 's' };
        })(),
        { close() {} },
      );
    await expect(
      collect(
        new ClaudeHarness({
          executable: process.execPath,
          cwd: process.cwd(),
          home: '/isolated',
          apiKey: 'explicit',
          query,
        }).run(turn()),
      ),
    ).rejects.toThrow('without a terminal result');
  });
  test('AI SDK current stream APIs execute a tool then finish; length termination is failure', async () => {
    const calls: unknown[] = [];
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const streamed = (parts: unknown[]) =>
      ({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }) as any;
    const finish = (reason: string) => ({
      type: 'finish',
      usage,
      finishReason: { unified: reason, raw: reason },
    });
    const model = new MockLanguageModelV4({
      doStream: [
        streamed([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'ai-call',
            toolName: toolName('app.ping'),
            input: '{"message":"hello"}',
          },
          finish('tool-calls'),
        ]),
        streamed([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'done' },
          { type: 'text-end', id: 'text' },
          finish('stop'),
        ]),
      ],
    });
    const events = await collect(new AiSdkHarness({ model }).run(turn(calls)));
    expect(calls.length).toBe(1);
    expect((calls[0] as any)[2].idempotencyKey).toBe('ai-call');
    expect(events).toContainEqual({ type: 'text', text: 'done' });
    const truncated = new MockLanguageModelV4({
      doStream: streamed([{ type: 'stream-start', warnings: [] }, finish('length')]),
    });
    await expect(collect(new AiSdkHarness({ model: truncated }).run(turn()))).rejects.toThrow(
      'length',
    );
  });

  test('AI SDK hands a refusal back to the model as the tool result; any other failure ends the run', async () => {
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const streamed = (parts: unknown[]) =>
      ({
        stream: new ReadableStream({
          start(controller) {
            for (const part of [{ type: 'stream-start', warnings: [] }, ...parts])
              controller.enqueue(part);
            controller.close();
          },
        }),
      }) as any;
    const finish = (reason: string) => ({
      type: 'finish',
      usage,
      finishReason: { unified: reason, raw: reason },
    });
    const call = (id: string, input = '{"message":"hello"}') => ({
      type: 'tool-call',
      toolCallId: id,
      toolName: toolName('app.ping'),
      input,
    });
    const prompts: unknown[] = [];
    const model = (input?: string) => {
      let step = 0;
      return new MockLanguageModelV4({
        doStream: async (options: { prompt: unknown }) => {
          prompts.push(options.prompt);
          return step++ === 0
            ? streamed([call('first', input), finish('tool-calls')])
            : streamed([
                { type: 'text-start', id: 't' },
                { type: 'text-delta', id: 't', delta: 'corrected' },
                { type: 'text-end', id: 't' },
                finish('stop'),
              ]);
        },
      });
    };
    const failing = (error: Error): HarnessTurn => ({
      ...turn(),
      tools: {
        ...turn().tools,
        execute: async () => {
          throw error;
        },
      },
    });
    const events = await collect(
      new AiSdkHarness({ model: model() }).run(
        failing(new ApplicationError('INVALID_INPUT', 'Input does not match operation schema')),
      ),
    );
    expect(events).toContainEqual({ type: 'text', text: 'corrected' });
    expect(JSON.stringify(prompts[1])).toContain('INVALID_INPUT');
    await expect(
      collect(new AiSdkHarness({ model: model() }).run(failing(new Error('database gone')))),
    ).rejects.toThrow('Application tool failed: app.ping');
    // Input the model could not form never reaches the tool; the model reads why and goes on.
    const calls: unknown[] = [];
    prompts.length = 0;
    const malformed = await collect(
      new AiSdkHarness({ model: model('{"message":') }).run(turn(calls)),
    );
    expect(calls).toEqual([]);
    expect(malformed).toContainEqual({ type: 'text', text: 'corrected' });
    expect(prompts).toHaveLength(2);
  });
});

test('AI SDK asks the person at the screen a question and reads the answer; a run without a screen has no ask tool', async () => {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const finish = (reason: string) => ({
    type: 'finish',
    usage,
    finishReason: { unified: reason, raw: reason },
  });
  const streamed = (parts: unknown[]) =>
    ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of [{ type: 'stream-start', warnings: [] }, ...parts])
            controller.enqueue(part);
          controller.close();
        },
      }),
    }) as any;
  const offered: string[][] = [];
  const prompts: unknown[] = [];
  const model = () => {
    let step = 0;
    return new MockLanguageModelV4({
      doStream: async (options: { prompt: unknown; tools?: { name: string }[] }) => {
        offered.push((options.tools ?? []).map((tool) => tool.name));
        prompts.push(options.prompt);
        return step++ === 0
          ? streamed([
              {
                type: 'tool-call',
                toolCallId: 'ask-1',
                toolName: ASK_TOOL,
                input: '{"question":"Which transformer?","choices":["T-1","T-2"]}',
              },
              finish('tool-calls'),
            ])
          : streamed([
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'ok' },
              { type: 'text-end', id: 't' },
              finish('stop'),
            ]);
      },
    });
  };
  const asked: unknown[] = [];
  const events = await collect(
    new AiSdkHarness({ model: model() }).run({
      ...turn(),
      context: { uiContext: { sessionId: 's', selectedResources: [] } },
      question: async (message, choices) => {
        asked.push([message, choices]);
        return 'T-2';
      },
    }),
  );
  expect(asked).toEqual([['Which transformer?', ['T-1', 'T-2']]]);
  expect(JSON.stringify(prompts[1])).toContain('T-2');
  // The question is the run's question event, never a tool call of its own.
  expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  expect(offered[0]).toContain(ASK_TOOL);
  offered.length = 0;
  await collect(new AiSdkHarness({ model: model() }).run(turn())).catch(() => undefined);
  expect(offered[0]).not.toContain(ASK_TOOL);
  // A trigger's run names its resource as UI context, but no screen waits on it.
  offered.length = 0;
  await collect(
    new AiSdkHarness({ model: model() }).run({
      ...turn(),
      context: { uiContext: { selectedResources: ['lot:l1'] } },
    }),
  ).catch(() => undefined);
  expect(offered[0]).not.toContain(ASK_TOOL);
});

for (const fixture of ['tool-envelope', 'turn-status', 'thread-response'] as const)
  test(`Codex rejects malformed ${fixture} rather than accepting success`, async () => {
    let closed = false;
    const rpc: any = {
      request: async (method: string) => {
        if (method === 'thread/start')
          return fixture === 'thread-response'
            ? { thread: { id: 42 } }
            : { thread: { id: 'thread' } };
        if (method === 'turn/start') {
          setTimeout(
            () =>
              rpc.onMessage(
                fixture === 'tool-envelope'
                  ? {
                      id: 1,
                      method: 'item/tool/call',
                      params: {
                        tool: toolName('app.ping'),
                        callId: 'call',
                        arguments: 'invalid-object-input',
                      },
                    }
                  : {
                      method: 'turn/completed',
                      params: { threadId: 'thread', turn: { id: 'turn', status: 42 } },
                    },
              ),
            1,
          );
          return { turn: { id: 'turn' } };
        }
        return {};
      },
      notify() {},
      close() {
        closed = true;
      },
    };
    const calls: unknown[] = [];
    await expect(
      collect(
        new CodexHarness({
          executable: process.execPath,
          cwd: process.cwd(),
          home: '/fixture',
          environment: {},
          createRpc: () => rpc,
          turnTimeoutMs: 200,
        }).run(turn(calls)),
      ),
    ).rejects.toThrow(fixture === 'thread-response' ? 'valid thread ID' : 'Malformed native');
    expect(closed).toBe(true);
    expect(calls.length).toBe(0);
  });

test('every adapter shows the model the captured selection and nothing else from the run context', async () => {
  const context = {
    principalId: 'owner',
    workspaceId: 'local',
    grant: { operations: ['task.update'], principalId: 'owner' },
    providerProfile: 'profile-secret',
    uiContext: {
      sessionId: 'ui-1',
      version: 3,
      selectedResources: ['task:id-3'],
      observedRevisions: { 'task:id-3': 4 },
    },
  };
  const selected = { ...turn(), prompt: 'Rename the selected task.', context };
  const prompts: string[] = [];

  const rpc: any = {
    request: async (method: string, params: any) => {
      if (method === 'thread/start') return { thread: { id: 'thread' } };
      if (method === 'turn/start') {
        prompts.push(params.input[0].text);
        setTimeout(() =>
          rpc.onMessage({
            method: 'turn/completed',
            params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } },
          }),
        );
        return { turn: { id: 'turn' } };
      }
      return {};
    },
    notify() {},
    close() {},
  };
  await collect(
    new CodexHarness({
      executable: process.execPath,
      cwd: process.cwd(),
      home: '/fixture',
      environment: {},
      createRpc: () => rpc,
    }).run(selected),
  );

  const query: any = ({ prompt }: any) => {
    prompts.push(prompt);
    return Object.assign(
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's' };
        yield { type: 'result', subtype: 'success', is_error: false };
      })(),
      { close() {} },
    );
  };
  await collect(
    new ClaudeHarness({
      executable: process.execPath,
      cwd: process.cwd(),
      home: '/isolated',
      apiKey: 'explicit-fixture',
      query,
    }).run(selected),
  );

  const model = new MockLanguageModelV4({
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({
            type: 'finish',
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          });
          controller.close();
        },
      }),
    } as any,
  });
  await collect(new AiSdkHarness({ model }).run(selected));
  prompts.push(JSON.stringify(model.doStreamCalls[0]!.prompt));

  expect(prompts).toHaveLength(3);
  for (const prompt of prompts) {
    expect(prompt).toContain('Rename the selected task.');
    expect(prompt).toContain('task:id-3 (revision 4)');
    for (const hidden of ['task.update', 'profile-secret', 'owner', 'ui-1'])
      expect(prompt).not.toContain(hidden);
  }
});
