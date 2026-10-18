import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolName } from '@agent-native/agents/types';
import { startHost } from '@agent-native/host/host';
import { lotsApplication, person, reviewOnReceive } from './fixture';

// An OpenAI-compatible model server on loopback. Its first answer requests approval for inspecting the lot
// named in the prompt; once the tool result is back it says done.
const completions: { tools: string[]; prompt: string }[] = [];
const chunk = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'qwen-local', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
async function answer(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/v1/models') return Response.json({ data: [{ id: 'qwen-local' }] });
  if (pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 });
  const body = (await request.json()) as {
    messages: { role: string; content?: unknown }[];
    tools?: { function: { name: string } }[];
  };
  const prompt = body.messages
    .filter((message) => message.role === 'user')
    .map((message) => JSON.stringify(message.content))
    .join('\n');
  completions.push({ tools: (body.tools ?? []).map((tool) => tool.function.name), prompt });
  const lot = /lot:(\w+)/.exec(prompt)?.[1] ?? 'unknown';
  const call = {
    input: {
      operation: 'lot.inspect',
      input: { id: lot },
      rationale: 'Received and not yet inspected.',
      resource: `lot:${lot}`,
      model: 'qwen-local',
    },
  };
  const events = body.messages.some((message) => message.role === 'tool')
    ? [chunk({ role: 'assistant', content: 'done' }), chunk({}, 'stop')]
    : [
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: toolName('approval.request'), arguments: JSON.stringify(call) },
            },
          ],
        }),
        chunk({}, 'tool_calls'),
      ];
  return new Response(`${events.join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: answer });
afterAll(() => server.stop(true));

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

test('a received lot starts a local-model run that requests approval for its inspection, and an inspector approves it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'automation-local-'));
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      destinations: { 'local-inference': { url: `http://127.0.0.1:${server.port}` } },
    }),
  );
  const host = await startHost(
    lotsApplication({
      triggers: [reviewOnReceive],
      localModel: { model: 'qwen-local' },
      network: true,
    }).definition,
    {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'site-policy': policy },
    },
  );
  const app = host.application;
  const query = async (operation: string, input: unknown): Promise<any> =>
    (await app.queryRaw({ operation, input }, person('ann'))).data;
  const open = async () => (await query('approval.list', { status: 'pending' })).items;
  try {
    await app.invokeRaw(
      {
        operation: 'automation.grant.issue',
        input: { trigger: 'review-on-receive', expiresInMs: 3_600_000 },
      },
      person('ann'),
    );
    await until(
      async () =>
        (await query('automation.trigger.list', {})).items.find(
          (item: { id: string; cursor?: number }) => item.id === 'review-on-receive',
        )?.cursor !== undefined,
    );
    await app.invokeRaw({ operation: 'lot.receive', input: { id: 'l1' } }, person('vic'));
    await until(async () => (await open()).length === 1);

    // The run requested approval under the grant's issuer and changed nothing.
    const [approval] = await open();
    expect(approval).toMatchObject({
      operation: 'lot.inspect',
      input: { id: 'l1' },
      resource: 'lot:l1',
      model: 'qwen-local',
      requestedBy: 'ann',
      status: 'pending',
    });
    expect(approval.runId).toBeString();
    expect((await query('lot.get', { id: 'l1' })).inspections).toBe(0);
    // The model saw the lot it was started on, could read it and request approval, and never got the
    // command itself as a tool.
    expect(completions[0]!.prompt).toContain('lot:l1');
    expect(completions[0]!.tools.sort()).toEqual(
      [toolName('lot.get'), toolName('approval.request')].sort(),
    );

    // Approving runs the command as the approver: a viewer is refused and it stays open.
    await expect(
      app.invokeRaw(
        { operation: 'approval.approve', input: { id: approval.id }, idempotencyKey: 'by-vic' },
        person('vic'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await open()).toHaveLength(1);
    await app.invokeRaw(
      { operation: 'approval.approve', input: { id: approval.id }, idempotencyKey: 'by-ann' },
      person('ann'),
    );
    expect((await query('lot.get', { id: 'l1' })).inspections).toBe(1);
    expect((await query('approval.get', { id: approval.id })) as object).toMatchObject({
      status: 'approved',
      closedBy: 'ann',
    });
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
