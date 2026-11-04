import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineAgent, defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import type { AuthorizationPort } from '@tortoise/runtime';
import type { Harness, HarnessTurn, RunSnapshot } from '@tortoise/agents/types';
import { defineApplication } from '../src/application';
import { createCli } from '../src/cli';
import { startHost } from '../src/host';
import { defineManifest } from '../src/manifest';
import { defineHostPlugin } from '../src/plugin';
import { definePluginManifest } from '../src/plugin-manifest';
import { openPlugins } from '../src/plugins/lifecycle';

const idInput = jsonSchema(z.strictObject({ id: z.string() }));
const quote = jsonSchema(z.strictObject({ id: z.string(), revision: z.number() }));
const quoteGet = defineCapability({
  id: 'quote.get',
  kind: 'query',
  description: 'One quote.',
  input: idInput,
  output: quote,
  permission: { action: 'read', resourceType: 'Quote' },
  ui: { binding: 'quote.get' },
});
const quoteCreate = defineCapability({
  id: 'quote.create',
  kind: 'command',
  description: 'Create a draft quote.',
  input: idInput,
  output: quote,
  permission: { action: 'write', resourceType: 'Quote' },
  ui: { binding: 'quote.create' },
});
const quoteCancel = defineCapability({
  id: 'quote.cancel',
  kind: 'command',
  description: 'Cancel a quote.',
  input: idInput,
  output: quote,
  permission: { action: 'write', resourceType: 'Quote' },
  ui: { binding: 'quote.cancel' },
});
const quoteRecompute = defineCapability({
  id: 'quote.recompute',
  kind: 'command',
  description: 'Recompute prices.',
  input: idInput,
  output: quote,
  permission: { action: 'write', resourceType: 'Quote' },
  ui: { exception: 'a job runs it' },
});
const desk = defineAgent({
  id: 'quote.desk',
  title: 'Desk assistant',
  instructions: 'Prepare quotes for callers.',
  operations: ['quote.get', 'quote.create'],
  model: 'local',
  output: 'direct',
  budgets: { turns: 4, toolCalls: 10, wallTimeMs: 60_000 },
});
const manifest = defineManifest({
  id: 'quotes',
  title: 'Quotes',
  modules: [
    defineModule({
      id: 'quotes',
      capabilities: [quoteGet, quoteCreate, quoteCancel, quoteRecompute],
      agents: [desk],
    }),
  ],
});
const open: AuthorizationPort<unknown> = {
  authorize: () => ({ allowed: true }),
  canReadEvent: () => true,
};
type State = { quotes: Record<string, { id: string; revision: number }> };
const definition = defineApplication<State>({
  manifest,
  createState: () => ({ quotes: {} }),
  handlers: [
    {
      capability: quoteGet,
      handle: async ({ id }: { id: string }, ctx) => ctx.state.quotes[id] ?? { id, revision: 0 },
    },
    ...[quoteCreate, quoteCancel, quoteRecompute].map((capability) => ({
      capability,
      handle: async ({ id }: { id: string }, ctx: any) => {
        const revision = (ctx.state.quotes[id]?.revision ?? 0) + 1;
        ctx.state.quotes[id] = { id, revision };
        ctx.change(`quote:${id}`);
        return { id, revision };
      },
    })),
  ],
  authorization: open,
  selectableResources: { quote: 'quote.get' },
});

/** A local-model stand-in that records what it was given and calls the tools a script names. */
function localStandIn(seen: {
  prompts: string[];
  tools: string[][];
  earlier?: (HarnessTurn['earlier'] | undefined)[];
}): Harness {
  return {
    id: 'local-stand-in',
    features: { questions: true, approvals: false, resume: false },
    inference: 'local',
    availability: async () => ({ available: true }),
    async *run(turn: HarnessTurn) {
      seen.prompts.push(turn.prompt);
      seen.earlier?.push(turn.earlier);
      seen.tools.push((turn.tools.definitions ?? []).map((tool) => tool.operation));
      yield { type: 'text', text: 'done' };
    },
  };
}

let close: (() => Promise<void>) | undefined;
let directory: string | undefined;
afterEach(async () => {
  await close?.();
  if (directory) await rm(directory, { recursive: true, force: true });
  close = directory = undefined;
});

async function start(harnesses: Harness[] = []) {
  directory = await mkdtemp(join(tmpdir(), 'agent-runs-'));
  const host = await startHost(definition, {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    harnesses,
  });
  close = host.close;
  const session = host.sessions.create({ principalId: 'local-user', workspaceId: 'local' });
  const call = async <T>(path: string, body?: unknown) => {
    const response = await fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const settled = async (id: string) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await host.supervisor.get(id);
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
      await Bun.sleep(5);
    }
    throw new Error('Run did not settle');
  };
  return { host, call, settled, session };
}

const tool = (operation: string, input: unknown) => ({ operation, input: { input } });

test('a run started under an agent definition acts only within the definition', async () => {
  const { call, settled } = await start();
  const started = await call<RunSnapshot>('/api/v1/runs', {
    agentId: 'quote.desk',
    harnessId: 'deterministic',
    prompt: JSON.stringify({
      commands: [tool('quote.create', { id: 'q1' }), tool('quote.cancel', { id: 'q1' })],
    }),
  });
  expect(started.status).toBe(202);
  const run = await settled(started.body.id);
  // The create committed; the cancel is outside the definition, so the run ends refused.
  expect(run.state).toBe('failed');
  expect(run.context.agentId).toBe('quote.desk');
  expect((run.context.delegation as { operations: string[] }).operations).toEqual([
    'quote.get',
    'quote.create',
  ]);
  const finished = run.events.filter((event) => event.type === 'tool-finish');
  expect(finished.map((event) => event.resources)).toEqual([['quote:q1']]);
  expect((await call('/api/v1/runs', { agentId: 'quote.missing', prompt: 'x' })).status).toBe(404);
});

test('without a harness the host picks the first one the agent may run on, with its instructions and tools', async () => {
  const seen = { prompts: [] as string[], tools: [] as string[][] };
  const { call, settled } = await start([localStandIn(seen)]);
  const ui = await call<{ sessionId: string }>('/api/v1/ui/sessions', {
    selectedResources: [],
    observedRevisions: {},
  });
  const first = await call<RunSnapshot>('/api/v1/runs', {
    agentId: 'quote.desk',
    prompt: 'Quote two bushings for T-4471.',
    uiSessionId: ui.body.sessionId,
  });
  expect(first.status).toBe(202);
  expect((await settled(first.body.id)).harnessId).toBe('local-stand-in');
  expect(seen.prompts[0]).toStartWith('Prepare quotes for callers.\n\nQuote two bushings');
  expect(seen.tools[0]).toEqual([
    'quote.create',
    'quote.get',
    'ui.open',
    'ui.select',
    'ui.prepare',
    'ui.request-review',
  ]);
  // A follow-up continues the caller's own conversation; another conversation ID is unknown.
  const second = await call<RunSnapshot>('/api/v1/runs', {
    agentId: 'quote.desk',
    prompt: 'Make it three.',
    conversationId: first.body.conversationId,
  });
  expect(second.body.conversationId).toBe(first.body.conversationId);
  await settled(second.body.id);
  expect(
    (
      await call('/api/v1/runs', {
        agentId: 'quote.desk',
        prompt: 'x',
        conversationId: 'forged',
      })
    ).status,
  ).toBe(404);
  // A free-form run cannot continue an agent's conversation.
  expect(
    (
      await call('/api/v1/runs', {
        harnessId: 'deterministic',
        prompt: JSON.stringify({ commands: [] }),
        conversationId: first.body.conversationId,
      })
    ).status,
  ).toBe(409);
});

test('a run prepares a bound command form on its screen; an unbound command is refused', async () => {
  const { call, settled } = await start();
  const ui = await call<{ sessionId: string }>('/api/v1/ui/sessions', {
    selectedResources: [],
    observedRevisions: {},
  });
  const run = async (commands: unknown[]) =>
    settled(
      (
        await call<RunSnapshot>('/api/v1/runs', {
          agentId: 'quote.desk',
          harnessId: 'deterministic',
          prompt: JSON.stringify({ commands }),
          uiSessionId: ui.body.sessionId,
        })
      ).body.id,
    );
  expect(
    (await run([tool('ui.prepare', { operation: 'quote.create', input: { id: 'q9' } })])).state,
  ).toBe('succeeded');
  expect(
    (await run([tool('ui.prepare', { operation: 'quote.recompute', input: { id: 'q9' } })])).state,
  ).toBe('failed');
  const intents = await call<{ intent: unknown }[]>(
    `/api/v1/ui/sessions/${ui.body.sessionId}/intents`,
  );
  expect(intents.body.map((entry) => entry.intent)).toEqual([
    { type: 'prepare', operation: 'quote.create', input: { id: 'q9' } },
  ]);
});

test('a plugin offers harnesses to the host', async () => {
  const seen = { prompts: [] as string[], tools: [] as string[][] };
  const offering = defineHostPlugin({
    manifest: definePluginManifest({ id: 'offering', title: 'Offering' }),
    open: async () => ({ harnesses: [localStandIn(seen)] }),
  });
  const withPlugin = defineApplication<State>({
    ...definition,
    manifest: defineManifest({ ...manifest, plugins: [offering.manifest] }),
    plugins: [offering],
  });
  const opened = await openPlugins(withPlugin, {
    workspacePath: tmpdir(),
    component: 'host',
    instance: 'test',
    serving: true,
  } as never);
  expect(opened.harnesses().map((harness) => (harness as Harness).id)).toEqual(['local-stand-in']);
  await opened.close();
});

test('a run keeps what the person asked, and a follow-up gives a harness without resume the earlier turns', async () => {
  const seen = {
    prompts: [] as string[],
    tools: [] as string[][],
    earlier: [] as (HarnessTurn['earlier'] | undefined)[],
  };
  const { call, settled } = await start([localStandIn(seen)]);
  const first = await call<RunSnapshot>('/api/v1/runs', {
    agentId: 'quote.desk',
    prompt: 'Quote two bushings.',
  });
  await settled(first.body.id);
  const second = await call<RunSnapshot>('/api/v1/runs', {
    agentId: 'quote.desk',
    prompt: 'Make it three.',
    conversationId: first.body.conversationId,
  });
  await settled(second.body.id);
  // The run keeps the request without the instructions the harness read before it.
  const read = await call<RunSnapshot>(`/api/v1/runs/${first.body.id}`);
  expect(read.body.request).toBe('Quote two bushings.');
  expect(seen.prompts[0]).toStartWith('Prepare quotes for callers.');
  expect(seen.earlier).toEqual([undefined, [{ request: 'Quote two bushings.', reply: 'done' }]]);
  expect((await call(`/api/v1/runs/unknown`)).status).toBe(404);
  expect((await call('/api/v1/harnesses')).body).toEqual([
    { id: 'local-stand-in', inference: 'local', available: true },
  ]);
});

test('the CLI starts, lists, shows and answers runs through the connection file', async () => {
  const { host, session } = await start();
  const connection = join(directory!, 'connection.json');
  await writeFile(connection, JSON.stringify({ endpoint: host.url + '/', token: session.token }));
  const main = createCli(definition, { program: 'quotes' });
  const output: string[] = [];
  const log = console.log;
  console.log = (line: string) => void output.push(line);
  const last = () => JSON.parse(output.at(-1)!) as RunSnapshot;
  try {
    const script = JSON.stringify({ question: 'Which quote?', commands: [], text: 'done' });
    const runs = ['runs', '--connection', connection];
    expect(await main([...runs, 'start', '--harness', 'deterministic', '--wait', script])).toBe(75);
    const asked = last();
    expect(asked.state).toBe('awaiting-question');
    expect(await main([...runs, 'answer', asked.id, 'q1'])).toBe(0);
    expect(last().events.find((event) => event.type === 'answer')?.text).toBe('q1');
    expect(await main([...runs, 'list'])).toBe(0);
    expect(last()).toMatchObject({ id: asked.id, state: 'succeeded', request: script });
    expect(await main([...runs, 'show', asked.id])).toBe(0);
    expect(last().state).toBe('succeeded');
    expect(await main([...runs, 'start', 'no agent'])).toBe(2);
  } finally {
    console.log = log;
  }
});
