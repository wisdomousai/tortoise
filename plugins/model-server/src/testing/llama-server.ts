// The stand-in for llama.cpp's llama-server that `llamaServerStandIn` in `../testing.ts` names;
// that comment says what it returns.
import { existsSync } from 'node:fs';
import type { StandInMessage, StandInReply, StandInResponder } from '../testing';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const model = flag('--model');
const alias = flag('--alias') ?? 'model';
const lora = flag('--lora');
if (!model || !existsSync(model) || (lora && !existsSync(lora))) {
  console.error(`error: failed to load model ${model}`);
  process.exit(1);
}
const call = process.env.FIXTURE_CALL ? JSON.parse(process.env.FIXTURE_CALL) : undefined;
const responder: StandInResponder | undefined = process.env.FIXTURE_RESPONDER
  ? (await import(process.env.FIXTURE_RESPONDER)).default
  : undefined;

async function reply(messages: readonly StandInMessage[]): Promise<StandInReply> {
  if (responder) return responder(messages);
  const hasToolResult = messages.some((message) => message.role === 'tool');
  return call && !hasToolResult ? { call } : { content: 'done' };
}

const chunk = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: alias, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(flag('--port')),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/models') return Response.json({ data: [{ id: alias }] });
    if (pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 });
    const { messages } = (await request.json()) as { messages: StandInMessage[] };
    const response = await reply(messages);
    const results = messages.filter((message) => message.role === 'tool').length;
    const events =
      'call' in response
        ? [
            chunk({
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call-${results + 1}`,
                  type: 'function',
                  function: {
                    name: response.call.name,
                    arguments: JSON.stringify(response.call.arguments),
                  },
                },
              ],
            }),
            chunk({}, 'tool_calls'),
          ]
        : [chunk({ role: 'assistant', content: response.content }), chunk({}, 'stop')];
    return new Response(`${events.join('')}data: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
});
console.error(`listening, model ${alias}`);
