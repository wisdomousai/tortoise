// A stand-in for llama.cpp's llama-server: it takes the same flags, refuses a missing model file,
// lists the model under its alias, and answers chat completions as a stream. With
// FIXTURE_CALL set (a tool name and JSON arguments) it first calls that tool, then says done.
import { existsSync } from 'node:fs';

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
const chunk = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: alias, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(flag('--port')),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/models') return Response.json({ data: [{ id: alias }] });
    if (pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 });
    const body = (await request.json()) as { messages: { role: string }[] };
    const answered = body.messages.some((message) => message.role === 'tool');
    const events =
      call && !answered
        ? [
            chunk({
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                },
              ],
            }),
            chunk({}, 'tool_calls'),
          ]
        : [chunk({ role: 'assistant', content: 'done' }), chunk({}, 'stop')];
    return new Response(`${events.join('')}data: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  },
});
console.error(`listening, model ${alias}`);
