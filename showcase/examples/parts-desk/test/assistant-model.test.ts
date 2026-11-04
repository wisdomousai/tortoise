import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunSnapshot, RunState } from '@tortoise/agents/types';
import type { ApprovalRequest } from '@tortoise/contracts';
import { startHost } from '@tortoise/host/host';
import { llamaServerStandIn } from '@tortoise/model-server/testing';
import { composePartsDesk } from '../application';
import {
  ASSISTANT_MODEL,
  ASSISTANT_MODEL_PROCESS,
  assistantAgent,
} from '../contracts/assistant-agent';
import { standInEntry } from '../model';
import { seedTrialRecords } from '../trial-records';
import { draftQuote, localUser, utilityIds } from './support';

// The assistant on the model server, with the llama-server stand-in playing the model from
// responder.ts. One serving host holds the trial records, and each run starts as a person's
// screen starts it: through the run route, with the assistant's agent ID and no harness.
let directory: string;
let host: Awaited<ReturnType<typeof startHost>>;
let models: ReturnType<typeof composePartsDesk>['models'];
let token: string;

/** A loopback port no listener holds, for the stand-in the deployment policy binds. */
function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'parts-desk-model-'));
  const port = freePort();
  const policy = join(directory, 'deployment-policy.json');
  // The policy dev.ts writes for the stand-in, on a port of the test's own.
  await writeFile(
    policy,
    JSON.stringify({
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'fail-closed' },
      destinations: {
        'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 },
      },
      processes: {
        [ASSISTANT_MODEL_PROCESS]: {
          executable: process.execPath,
          args: [llamaServerStandIn, '--host', '127.0.0.1', '--port', String(port)],
          env: { FIXTURE_RESPONDER: join(import.meta.dir, '..', 'responder.ts') },
        },
      },
    }),
  );
  const composed = composePartsDesk({ pollMs: 25 });
  models = composed.models;
  host = await startHost(composed.application, {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'deployment-policy': policy },
  });
  await seedTrialRecords(host.application);
  for (let tries = 0; tries < 400; tries++) {
    if (!['measuring', 'starting', 'stopped'].includes(models.status().state)) break;
    await Bun.sleep(25);
  }
  token = host.sessions.create(localUser).token;
});

afterAll(async () => {
  await host?.close();
  await rm(directory, { recursive: true, force: true });
});

async function post<T>(path: string, body: unknown) {
  const response = await fetch(host.url + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function get<T>(path: string) {
  const response = await fetch(host.url + path, { headers: { authorization: `Bearer ${token}` } });
  return (await response.json()) as T;
}

/** Start a run of the assistant as the local user, without naming a harness. */
const start = (prompt: string, options: { uiSessionId?: string } = {}) =>
  post<RunSnapshot>('/api/v1/runs', { agentId: assistantAgent.id, prompt, ...options });

async function until(id: string, states: readonly RunState[]) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const run = await host.supervisor.get(id);
    if (run && states.includes(run.state)) return run;
    await Bun.sleep(10);
  }
  throw new Error(`Run ${id} did not reach ${states.join(' or ')}`);
}
const ended = (id: string) => until(id, ['succeeded', 'failed', 'cancelled']);

/** The finished calls of a run, with the refusal code of each refused one. */
const calls = (run: RunSnapshot) =>
  run.events
    .filter((event) => event.type === 'tool-finish')
    .map((event) => (event.code ? `${event.operation} ${event.code}` : event.operation));
const answer = (run: RunSnapshot) =>
  run.events
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');

test("a run of the assistant without a harness runs on the model server's harness, and the stand-in's run for TR-40417 calls transformer.find", async () => {
  expect(models.status()).toMatchObject({
    state: 'ready',
    model: { entry: ASSISTANT_MODEL, digest: standInEntry.base.digest, verified: true },
  });
  const started = await start(
    'A caller reads TR-40417 off the rating plate. Which transformer is it?',
  );
  expect(started.status).toBe(202);
  expect(started.body.harnessId).toBe(models.harness.id);
  const run = await ended(started.body.id);
  expect(run.state).toBe('succeeded');
  // The run records the entry and the digest the plugin measured before the server started.
  expect(run.model).toMatchObject({
    entry: ASSISTANT_MODEL,
    digest: standInEntry.base.digest,
    verified: true,
  });
  expect(calls(run)).toEqual(['transformer.find']);
  expect(answer(run)).toStartWith('TR-40417 is a PTX-40 of Stadtwerke Nordhafen');
});

test('from a screen, the stand-in asks which transformer TR-404 means and continues with the answer', async () => {
  const ui = await post<{ sessionId: string }>('/api/v1/ui/sessions', {
    selectedResources: [],
    observedRevisions: {},
  });
  const started = await start('A caller from Alpental reads TR-404 off the plate.', {
    uiSessionId: ui.body.sessionId,
  });
  const waiting = await until(started.body.id, ['awaiting-question']);
  const question = waiting.events.find((event) => event.type === 'question')!;
  expect(question.choices).toEqual(['TR-40417', 'TR-40471']);
  const answered = await post(`/api/v1/runs/${started.body.id}/respond`, {
    type: 'question',
    requestId: question.requestId,
    answer: 'TR-40471',
  });
  expect(answered.status).toBe(200);
  const run = await ended(started.body.id);
  expect(run.state).toBe('succeeded');
  expect(calls(run)).toEqual(['transformer.find', 'transformer.find']);
  expect(answer(run)).toStartWith('TR-40471 is a PTX-40 of Alpental Energie');
});

test('the stand-in looks up HV bushings, requests approval above 10 percent and declines the rest', async () => {
  const bushings = await ended((await start('Which HV bushings fit TR-40417?')).body.id);
  expect(calls(bushings)).toEqual(['transformer.find', 'part.search']);
  expect(answer(bushings)).toContain('BSH-145-1250, HV bushing 145 kV 1250 A, OIP: 2 in stock');

  // Without a person at the screen there is no ask_person tool, so the question is the answer.
  const ambiguous = await ended((await start('Which transformer is TR-404?')).body.id);
  expect(ambiguous.state).toBe('succeeded');
  expect(calls(ambiguous)).toEqual(['transformer.find']);
  expect(answer(ambiguous)).toEndWith('Which transformer do you mean?');

  const quote = await draftQuote(host.application);
  const discount = await ended(
    (
      await start(
        `The utility wants 15 percent off ${quote.result.number} because of a late delivery.`,
      )
    ).body.id,
  );
  expect(calls(discount)).toEqual(['quote.list', 'approval.request']);
  const { data } = await host.application.queryRaw(
    { operation: 'approval.list', input: { status: 'pending' } },
    localUser,
  );
  expect((data as { items: ApprovalRequest[] }).items).toMatchObject([
    {
      operation: 'quote.discount',
      input: { id: quote.result.id, percent: 15, reason: 'A late delivery' },
      resource: `quote:${quote.result.id}`,
      runId: discount.id,
    },
  ]);

  const other = await ended((await start('What is the weather in Hamburg?')).body.id);
  expect(calls(other)).toEqual([]);
  expect(answer(other)).toStartWith('I cannot help with that yet.');
});

test('from a screen, the stand-in prepares a quote of two HV bushings in the quote form and creates nothing', async () => {
  const quotes = async () =>
    (await host.application.queryRaw({ operation: 'quote.list', input: { limit: 1 } }, localUser))
      .data as { total: number };
  const before = (await quotes()).total;
  const ui = await post<{ sessionId: string }>('/api/v1/ui/sessions', {
    selectedResources: [],
    observedRevisions: {},
  });
  const request = 'Prepare a quote of two HV bushings for TR-40417.';
  const run = await ended((await start(request, { uiSessionId: ui.body.sessionId })).body.id);
  expect(run.state).toBe('succeeded');
  expect(calls(run)).toEqual(['transformer.find', 'part.search', 'ui.prepare']);
  expect(answer(run)).toStartWith(
    'I filled in the quote form for TR-40417 with 2 × BSH-145-1250, HV bushing 145 kV 1250 A, OIP',
  );
  // The intent waits in the screen's session for the person; the run created no quote.
  const intents = await get<{ intent: unknown }[]>(
    `/api/v1/ui/sessions/${ui.body.sessionId}/intents`,
  );
  const ids = await utilityIds(host.application);
  expect(intents.map((entry) => entry.intent)).toEqual([
    {
      type: 'prepare',
      operation: 'quote.create',
      input: {
        customerId: ids.U1042!,
        transformerSerial: 'TR-40417',
        lines: [{ partNumber: 'BSH-145-1250', quantity: 2 }],
      },
    },
  ]);
  expect((await quotes()).total).toBe(before);

  // Without a person at a screen there is no form to fill, so the answer names the lines.
  const unattended = await ended((await start(request)).body.id);
  expect(calls(unattended)).toEqual(['transformer.find', 'part.search']);
  expect(answer(unattended)).toContain('A quote for TR-40417 would hold 2 × BSH-145-1250');
  expect((await quotes()).total).toBe(before);
});
