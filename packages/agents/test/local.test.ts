import { afterAll, describe, expect, test } from 'bun:test';
import { localHarness, type LocalModelClient } from '../src/local';
import { chooseHarness, satisfiesModel } from '../src/placement';
import { createRunSupervisor } from '../src/supervisor';
import { deterministicHarness } from '../src/deterministic';
import { toolName, type Harness, type HarnessTurn } from '../src/types';

// An OpenAI-compatible fixture server on loopback: it lists one model and answers chat
// completions as a stream, first with a tool call and, once the tool result is back, with text.
const seen: { path: string; authorization: string | null; body?: any }[] = [];
const chunk = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'qwen-local', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : undefined;
    seen.push({ path: pathname, authorization: request.headers.get('authorization'), body });
    if (pathname === '/v1/models') return Response.json({ data: [{ id: 'qwen-local' }] });
    if (pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 });
    const answered = body.messages.some((message: { role: string }) => message.role === 'tool');
    const events = answered
      ? [chunk({ role: 'assistant', content: 'done' }), chunk({}, 'stop')]
      : [
          chunk({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                type: 'function',
                function: { name: toolName('app.ping'), arguments: '{"message":"hi"}' },
              },
            ],
          }),
          chunk({}, 'tool_calls'),
        ];
    return new Response(`${events.join('')}data: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
});
afterAll(() => server.stop(true));

// What the network port's `client('local-inference')` does once the policy binds the server.
const bound = (): LocalModelClient => ({
  fetch: (path, init) => fetch(new URL(path, `http://127.0.0.1:${server.port}/`), init),
});
const model = { model: 'qwen-local', digest: 'sha256:abc' };

function turn(calls: unknown[]): HarnessTurn {
  return {
    runId: 'local-run',
    conversationId: 'local-run',
    prompt: 'Ping, then say done.',
    context: {},
    signal: new AbortController().signal,
    tools: {
      definitions: [
        {
          operation: 'app.ping',
          description: 'Ping the application',
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
    question: async () => '',
    approve: async () => false,
  };
}

describe('local inference', () => {
  test('a run calls application tools through a loopback server and sends no provider key', async () => {
    const harness = localHarness({ ...model, client: bound });
    expect(await harness.availability()).toEqual({ available: true });
    const calls: unknown[] = [];
    const events = [];
    for await (const event of harness.run(turn(calls))) events.push(event);
    expect(calls).toEqual([
      ['app.ping', { message: 'hi' }, expect.objectContaining({ runId: 'local-run' })],
    ]);
    expect(events).toContainEqual({ type: 'text', text: 'done' });
    const completions = seen.filter((request) => request.path === '/v1/chat/completions');
    expect(completions).toHaveLength(2);
    expect(completions[0]!.body.model).toBe('qwen-local');
    expect(new Set(seen.map((request) => request.authorization))).toEqual(
      new Set([null, 'Bearer local']),
    );
  });

  test('availability names a model the server does not serve and an unbound destination', async () => {
    const missing = localHarness({ model: 'other', client: bound });
    expect(await missing.availability()).toEqual({
      available: false,
      reason: 'Local model server does not serve other',
    });
    const unbound = localHarness({
      ...model,
      client: () => {
        throw new Error('Destination local-inference is not bound');
      },
    });
    expect((await unbound.availability()).available).toBe(false);
  });

  test('model requirements choose the harness and the run records the model', async () => {
    const local = localHarness({ ...model, client: bound });
    const provider: Harness = { ...deterministicHarness, id: 'provider', inference: undefined };
    expect(satisfiesModel('local', provider)).toBe(false);
    expect(satisfiesModel('remote', local)).toBe(false);
    expect(satisfiesModel('local', deterministicHarness)).toBe(true);
    expect(satisfiesModel('any', provider)).toBe(true);
    expect((await chooseHarness('local', [provider, local])).id).toBe('local');
    await expect(chooseHarness('local', [provider])).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });

    const supervisor = createRunSupervisor({
      harnesses: [local, provider],
      tools: { execute: async () => ({}) },
    });
    await expect(
      supervisor.start({ harnessId: 'provider', prompt: '{"commands":[]}', model: 'local' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const run = await supervisor.start({ harnessId: 'local', prompt: 'hi', model: 'local' });
    expect(run.model).toEqual({ provider: 'local', model: 'qwen-local', digest: 'sha256:abc' });
  });
});
