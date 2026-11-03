import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { RunSnapshot, RunState } from '@agent-native/agents/types';
import type { ApprovalRequest } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { measure } from '@agent-native/model-server/measure';
import { composePartsDesk } from '../application';
import { ASSISTANT_MODEL_PROCESS, assistantAgent } from '../contracts/assistant-agent';
import { conversationPrompt, type Turn } from '../conversation';
import { ASSISTANT_CONTEXT_TOKENS, assistantModelEntry } from '../model';
import { seedTrialRecords } from '../trial-records';
import { owner, supervisor, utilityIds } from './support';

/**
 * Turns 1 and 4 of the desk's conversation on a real model, skipped unless LOCAL_MODEL_GGUF names
 * GGUF weights of an instruction model that calls tools, such as Gemma 4 E4B-it Q4_0. The model
 * server starts llama.cpp `llama-server` (LLAMA_SERVER, or the one on PATH) on the measured
 * weights, and each run starts as the assistant panel starts it: through the run route, with the
 * assistant's agent ID, no harness and a UI session. LOCAL_MODEL_LICENSE names the license.
 *
 * Each test judges the receipts: the calls a run finished and their refusal codes, the questions it
 * asked through the question tool, the records it changed and the approval requests it made, and
 * what approving such a request as a supervisor commits. It never judges the text. A test holds
 * the whole turn and fails at its end with every rule the run broke, so one run shows all of them.
 */
const weights = process.env.LOCAL_MODEL_GGUF;
const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
const live = weights && executable ? test : test.skip;

let directory: string | undefined;
let host: Awaited<ReturnType<typeof startHost>> | undefined;
let token: string;

/** A loopback port no listener holds, for llama-server. */
function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port;
}

beforeAll(async () => {
  if (!weights || !executable) return;
  directory = await mkdtemp(join(tmpdir(), 'parts-desk-live-'));
  const port = freePort();
  const policy = join(directory, 'site-policy.json');
  // The policy dev.ts writes for LOCAL_MODEL_GGUF, on a port of the test's own.
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
          executable,
          args: [
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--ctx-size',
            String(ASSISTANT_CONTEXT_TOKENS),
          ],
        },
      },
    }),
  );
  const entry = assistantModelEntry(
    { name: basename(weights, '.gguf'), digest: await measure(weights) },
    process.env.LOCAL_MODEL_LICENSE ?? 'Apache-2.0',
  );
  const { application, models } = composePartsDesk({
    model: { entry, files: { base: weights } },
    members: { mara: 'supervisor' },
    pollMs: 250,
  });
  host = await startHost(application, {
    workspacePath: join(directory, 'workspace'),
    integration: false,
    settings: { 'site-policy': policy },
  });
  await seedTrialRecords(host.application);
  for (let tries = 0; tries < 1200; tries++) {
    if (!['measuring', 'starting', 'stopped'].includes(models.status().state)) break;
    await Bun.sleep(250);
  }
  expect(models.status()).toMatchObject({ state: 'ready' });
  token = host.sessions.create(owner).token;
}, 600_000);

afterAll(async () => {
  await host?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function post<T>(path: string, body: unknown) {
  const response = await fetch(host!.url + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

/** A UI session as a screen opens one, with the records the screen hands to the panel. */
async function uiSession(records: readonly string[] = []) {
  const session = await post<{ sessionId: string }>('/api/v1/ui/sessions', {
    selectedResources: records,
    observedRevisions: Object.fromEntries(records.map((record) => [record, 0])),
  });
  return session.body.sessionId;
}

/** Start a run of the assistant as the owner from the panel, without naming a harness. */
async function start(prompt: string, uiSessionId: string, conversationId?: string) {
  const started = await post<RunSnapshot>('/api/v1/runs', {
    agentId: assistantAgent.id,
    prompt,
    uiSessionId,
    ...(conversationId ? { conversationId } : {}),
  });
  expect(started.status).toBe(202);
  return started.body;
}

/** The run once it ends or waits for the person; a model turn takes tens of seconds. */
async function until(
  id: string,
  states: readonly RunState[] = ['succeeded', 'failed', 'cancelled', 'awaiting-question'],
) {
  for (let attempt = 0; attempt < 2400; attempt++) {
    const run = await host!.supervisor.get(id);
    if (run && states.includes(run.state)) return run;
    await Bun.sleep(250);
  }
  throw new Error(`Run ${id} did not reach ${states.join(' or ')}`);
}

/** A run's receipts: its finished calls with refusal codes and changed records, and its questions. */
function receipts(run: RunSnapshot) {
  return {
    id: run.id,
    state: run.state,
    seconds: (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000,
    ...(run.failure ? { failure: run.failure.code } : {}),
    calls: run.events
      .filter((event) => event.type === 'tool-finish')
      .map((event) => ({
        operation: event.operation!,
        ...(event.code ? { code: event.code } : {}),
        ...(event.resources?.length ? { resources: event.resources } : {}),
      })),
    questions: run.events
      .filter((event) => event.type === 'question')
      .map((event) => ({ requestId: event.requestId!, choices: event.choices ?? [] })),
  };
}
const text = (run: RunSnapshot) =>
  run.events
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');

async function query<T>(operation: string, input: unknown) {
  return (await host!.application.queryRaw({ operation, input }, owner)).data as T;
}
const totals = async () => ({
  quotes: (await query<{ total: number }>('quote.list', { limit: 1 })).total,
  inquiries: (await query<{ total: number }>('inquiry.list', { limit: 1 })).total,
  approvals: (await query<{ total: number }>('approval.list', { limit: 1 })).total,
});

live(
  'turn 1: TR-404 from a caller of Northgrid finds both transformers, asks which one, and commits nothing',
  async () => {
    const failures: string[] = [];
    const before = await totals();
    const session = await uiSession();
    const request = 'A caller from Northgrid reads TR-404 off the plate. Which transformer is it?';
    let run = await until((await start(request, session)).id);
    const runs = [run];
    const first = receipts(run);
    if (first.calls[0]?.operation !== 'transformer.find' || first.calls[0]?.code)
      failures.push(`the first call is not transformer.find: ${JSON.stringify(first.calls)}`);

    if (run.state === 'awaiting-question') {
      const question = first.questions.at(-1)!;
      for (const serial of ['TR-40417', 'TR-40471'])
        if (!question.choices.includes(serial)) failures.push(`the question offers no ${serial}`);
      const answered = await post(`/api/v1/runs/${run.id}/respond`, {
        type: 'question',
        requestId: question.requestId,
        answer: 'TR-40471',
      });
      expect(answered.status).toBe(200);
      run = await until(run.id, ['succeeded', 'failed', 'cancelled']);
      runs[0] = run;
    } else {
      // The run asked in its text, or not at all; the panel's person then answers in a follow-up.
      failures.push('the run did not ask through the question tool');
      const earlier: Turn[] = [{ request, answer: text(run) }];
      runs.push(
        await until(
          (await start(conversationPrompt(earlier, 'TR-40471'), session, run.conversationId)).id,
          ['succeeded', 'failed', 'cancelled'],
        ),
      );
    }

    const all = runs.map(receipts);
    console.log(JSON.stringify(all, null, 2));
    for (const each of all) {
      if (each.state !== 'succeeded') failures.push(`run ${each.id} ended ${each.state}`);
      const changed = each.calls.filter((call) => call.resources);
      if (changed.length) failures.push(`a run changed records: ${JSON.stringify(changed)}`);
    }
    if (JSON.stringify(await totals()) !== JSON.stringify(before))
      failures.push('the turn added quotes, inquiries or approval requests');
    expect(failures).toEqual([]);
  },
  900_000,
);

live(
  "turn 4: 15 percent off the person's draft becomes an approval request that sets 15 percent when a supervisor approves it",
  async () => {
    const failures: string[] = [];
    // The person created the draft the assistant prepared: two HV bushings for TR-40471.
    const ids = await utilityIds(host!.application);
    const created = await host!.application.invokeRaw(
      {
        operation: 'quote.create',
        input: {
          customerId: ids.U2117!,
          transformerSerial: 'TR-40471',
          lines: [{ partNumber: 'BSH-145-1250', quantity: 2 }],
        },
        idempotencyKey: 'live-draft',
      },
      owner,
    );
    const quote = created.result as { id: string; number: string };
    const resource = `quote:${quote.id}`;
    // Turns 1 to 3 as the panel puts them before the request, with the answers the records give.
    const earlier: Turn[] = [
      {
        request: 'A caller from Northgrid reads TR-404 off the plate. Which transformer is it?',
        answer:
          'TR-404 matches TR-40417 (Stadtwerke Nordhafen) and TR-40471 (Alpental Energie). Which transformer do you mean?',
      },
      { request: 'TR-40471', answer: 'TR-40471 is a PTX-40 of Alpental Energie.' },
      {
        request: 'Which HV bushings fit it, and are they in stock?',
        answer:
          'BSH-145-1250, HV bushing 145 kV 1250 A, OIP, fits TR-40471: 2 in stock, lead time 84 days.',
      },
      {
        request: 'Prepare a quote for two of them.',
        answer: 'I filled in the quote form for TR-40471 with 2 × BSH-145-1250.',
      },
    ];
    // The quote screen hands the quote to the panel, so the run's context names it.
    const session = await uiSession([resource]);
    const prompt = conversationPrompt(
      earlier,
      'They want 15 percent off because of a late delivery.',
    );
    const run = await until((await start(prompt, session)).id, [
      'succeeded',
      'failed',
      'cancelled',
    ]);
    const result = receipts(run);
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== 'succeeded') failures.push(`the run ended ${result.state}`);
    const changed = result.calls.flatMap((call) => call.resources ?? []);
    if (changed.some((record) => !record.startsWith('approval-request:')))
      failures.push(`the run changed records other than approval requests: ${changed.join(', ')}`);
    const unchanged = await query<{ discountPercent: number; status: string }>('quote.get', {
      id: quote.id,
    });
    if (unchanged.discountPercent !== 0 || unchanged.status !== 'draft')
      failures.push(`the run changed ${quote.number}: ${JSON.stringify(unchanged)}`);

    const { items } = await query<{ items: ApprovalRequest[] }>('approval.list', {
      status: 'pending',
    });
    const requests = items.filter((item) => item.runId === run.id);
    console.log(JSON.stringify(requests, null, 2));
    if (requests.length !== 1) failures.push(`the run made ${requests.length} approval requests`);
    const requested = requests[0];
    if (requested) {
      if (requested.operation !== 'quote.discount')
        failures.push(`the request is for ${requested.operation}`);
      if (requested.resource !== resource)
        failures.push(`the request names ${requested.resource ?? 'no record'}, not ${resource}`);
      const input = requested.input as { id?: unknown; percent?: unknown; reason?: unknown };
      if (input.id !== quote.id) failures.push(`the request's input names quote ${input.id}`);
      if (input.percent !== 15) failures.push(`the request's input asks ${input.percent} percent`);
      if (typeof input.reason !== 'string' || !input.reason.trim())
        failures.push("the request's input gives no reason");
      const malformed = Object.keys(requested.baseRevisions ?? {}).filter(
        (key) => !/^[a-z][a-z-]*:[\w-]+$/.test(key),
      );
      if (malformed.length)
        failures.push(`the request's base revisions name ${JSON.stringify(malformed)}`);

      // The request is right only if approving it commits the discount.
      try {
        const approved = await host!.application.invokeRaw(
          { operation: 'approval.approve', input: { id: requested.id }, idempotencyKey: 'approve' },
          supervisor,
        );
        const after = await query<{ discountPercent: number }>('quote.get', { id: quote.id });
        if (after.discountPercent !== 15)
          failures.push(
            `approving set ${after.discountPercent} percent: ${JSON.stringify(approved.continuation ?? approved.result)}`,
          );
      } catch (error) {
        failures.push(`approving the request failed: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  },
  600_000,
);
