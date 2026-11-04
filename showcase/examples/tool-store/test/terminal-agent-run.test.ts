import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Harness, HarnessTurn, RunSnapshot } from '@tortoise/agents/types';
import { startHost } from '@tortoise/host/host';
import { createToolStoreApplication } from '../application';
import {
  calibrationPullPrompt,
  calibrationPullScript,
  readToolsScript,
  type SelectedTool,
} from '../ui/terminal-runs';

/**
 * Agent runs started from the counter terminal's UI session, over HTTP. The connection file's
 * token is the terminal's session, the workspace owner, as the terminal's browser is: it
 * registers the ticked tools as the session context and starts the runs. The runs use the
 * scripts and prompts the agent panel sends.
 */
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/** A provider stand-in that records the prompt and the tools a run offers, and calls none. */
function providerStandIn(seen: { prompts: string[]; tools: string[][] }): Harness {
  return {
    id: 'provider-stand-in',
    features: { questions: false, approvals: false, resume: false },
    inference: 'local',
    availability: async () => ({ available: true }),
    async *run(turn: HarnessTurn) {
      seen.prompts.push(turn.prompt);
      seen.tools.push((turn.tools.definitions ?? []).map((tool) => tool.operation));
      yield { type: 'text', text: 'done' };
    },
  };
}

async function startTerminal() {
  const seen = { prompts: [] as string[], tools: [] as string[][] };
  const directory = await mkdtemp(join(tmpdir(), 'tool-store-agent-run-'));
  const host = await startHost(createToolStoreApplication(), {
    workspacePath: directory,
    integration: false,
    harnesses: [providerStandIn(seen)],
  });
  cleanups.push(async () => {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { token } = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const call = async <T>(path: string, body?: unknown) => {
    const response = await fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  let keys = 0;
  const create = async (assetTag: string, description: string) => {
    const created = await call<{ result: { id: string } }>('/api/v1/commands/tool.create', {
      input: { assetTag, description, category: 'torque-tool', bin: 'A-03' },
      idempotencyKey: `create-${++keys}`,
    });
    expect(created.status).toBe(200);
    return created.body.result.id;
  };
  /** Register a UI session for the ticked tools, as the work area does. */
  const register = (tools: readonly SelectedTool[]) =>
    call<{ sessionId: string; version: number }>('/api/v1/ui/sessions', {
      selectedResources: tools.map((tool) => `tool:${tool.id}`),
      observedRevisions: Object.fromEntries(
        tools.map((tool) => [`tool:${tool.id}`, tool.revision]),
      ),
    });
  const settled = async (id: string) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await host.supervisor.get(id);
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
      await Bun.sleep(5);
    }
    throw new Error('Run did not settle');
  };
  const run = async (body: Record<string, unknown>) => {
    const started = await call<RunSnapshot>('/api/v1/runs', body);
    expect(started.status).toBe(202);
    return settled(started.body.id);
  };
  const intents = async (sessionId: string) =>
    (
      await call<{ id: string; intent: unknown; runId?: string }[]>(
        `/api/v1/ui/sessions/${sessionId}/intents`,
      )
    ).body;
  return { seen, call, create, register, run, intents };
}

test('a run captures the ticked tools, and its open and review reach that session only', async () => {
  const { call, create, register, run, intents } = await startTerminal();
  const wrench = await create('TC-00601', 'Torque wrench 20-100 Nm');
  const tester = await create('TC-00602', 'Insulation tester 5 kV');
  // The Tools tab ticks rows from tool.list, which gives each tool the revision tool.get gives.
  const listed = await call<{ data: { items: SelectedTool[] } }>('/api/v1/queries/tool.list', {
    input: {},
  });
  const read = await call<{ data: { revision: number } }>('/api/v1/queries/tool.get', {
    input: { id: wrench },
  });
  const rows = listed.body.data.items;
  expect(rows.find((tool) => tool.id === wrench)?.revision).toBe(read.body.data.revision);
  const ticked = [wrench, tester].map((id) => rows.find((tool) => tool.id === id)!);

  const terminal = await register(ticked);
  expect(terminal.status).toBe(200);
  const other = await register([]);

  // Start run on the demo harness: it reads each ticked tool and sends nothing to the screen.
  const reading = await run({
    harnessId: 'deterministic',
    prompt: readToolsScript(ticked),
    uiSessionId: terminal.body.sessionId,
    uiContextVersion: terminal.body.version,
  });
  expect(reading.state).toBe('succeeded');
  expect(reading.context.uiContext).toMatchObject({
    sessionId: terminal.body.sessionId,
    selectedResources: [`tool:${wrench}`, `tool:${tester}`],
  });
  expect(
    reading.events.filter((event) => event.type === 'tool-finish').map((e) => e.operation),
  ).toEqual(['tool.get', 'tool.get']);
  expect(await intents(terminal.body.sessionId)).toEqual([]);

  // Pull for calibration: an open for the first ticked tool and a review of its bin change.
  const pull = await run({
    harnessId: 'deterministic',
    prompt: calibrationPullScript(ticked[0]!),
    uiSessionId: terminal.body.sessionId,
    uiContextVersion: terminal.body.version,
  });
  expect(pull.state).toBe('succeeded');
  const sent = await intents(terminal.body.sessionId);
  expect(sent.map(({ intent, runId }) => ({ intent, runId }))).toEqual([
    { intent: { type: 'openResource', resource: `tool:${wrench}` }, runId: pull.id },
    {
      intent: {
        type: 'requestReview',
        title: 'Pull TC-00601 for calibration',
        operations: ['tool.update'],
        resources: [`tool:${wrench}`],
      },
      runId: pull.id,
    },
  ]);
  // The other session of the same terminal gets nothing, and the run changed no tool.
  expect(await intents(other.body.sessionId)).toEqual([]);
  expect(pull.events.some((event) => event.resources?.length)).toBe(false);
  const after = await call<{ data: { bin: string; revision: number } }>(
    '/api/v1/queries/tool.get',
    { input: { id: wrench } },
  );
  expect(after.body.data).toMatchObject({ bin: 'A-03', revision: read.body.data.revision });

  // The host refuses an open for a tool that does not exist; the run fails and sends nothing.
  const unknown = await run({
    harnessId: 'deterministic',
    prompt: JSON.stringify({
      commands: [{ operation: 'ui.open', input: { input: { resource: 'tool:no-such-tool' } } }],
    }),
    uiSessionId: terminal.body.sessionId,
  });
  expect(unknown.state).toBe('failed');
  expect((await intents(terminal.body.sessionId)).map((entry) => entry.id)).toEqual(
    sent.map((entry) => entry.id),
  );

  // A ticked tool whose revision is ahead of the instance is refused as the session context.
  expect((await register([{ ...ticked[0]!, revision: read.body.data.revision + 5 }])).status).toBe(
    409,
  );
});

test('a run started without a UI session has no ui tools', async () => {
  const { seen, create, register, run } = await startTerminal();
  const wrench: SelectedTool = {
    id: await create('TC-00601', 'Torque wrench 20-100 Nm'),
    assetTag: 'TC-00601',
    revision: 0,
  };

  // The demo script's open is refused: the run has no session to send it to.
  const demo = await run({ harnessId: 'deterministic', prompt: calibrationPullScript(wrench) });
  expect(demo.state).toBe('failed');
  expect(demo.context.uiContext).toBeUndefined();
  expect(demo.failure?.message).toContain('not started from a UI session');

  // A provider gets the brief with the instruction, and the ui tools only with a session.
  const prompt = calibrationPullPrompt('Calibration is due this week.', wrench);
  expect(prompt).toStartWith('Calibration is due this week.');
  expect(prompt).toContain('ui.open');
  expect(prompt).toContain('ui.request-review');
  expect(prompt).toContain('do not call tool.update');
  await run({ harnessId: 'provider-stand-in', prompt });
  const terminal = await register([wrench]);
  await run({
    harnessId: 'provider-stand-in',
    prompt,
    uiSessionId: terminal.body.sessionId,
    uiContextVersion: terminal.body.version,
  });
  expect(seen.prompts).toEqual([prompt, prompt]);
  const ui = (tools: string[]) => tools.filter((tool) => tool.startsWith('ui.'));
  expect(ui(seen.tools[0]!)).toEqual([]);
  expect(seen.tools[0]).toContain('tool.get');
  expect(ui(seen.tools[1]!)).toEqual(['ui.open', 'ui.select', 'ui.prepare', 'ui.request-review']);
});
