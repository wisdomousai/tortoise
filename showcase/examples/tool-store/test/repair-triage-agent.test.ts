import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicHarness } from '@agent-native/agents';
import { openEmbeddedInstance } from '@agent-native/host';
import {
  runAgentScenario,
  runAgentScenarios,
  type AgentScenario,
} from '@agent-native/testing/agent-scenarios';
import { createToolStoreApplication } from '../application';

// The repair triage agent judged by what it commits and what it requests approval for. The
// deterministic harness plays a scripted run; a model runs the same scenarios only when a test is
// given one. The fixture tools are lent and returned through the counter's commands.
const owner = { workspaceId: 'local', principalId: 'owner' };
const mia = { workspaceId: 'local', principalId: 'mia@plant' };
const sam = { workspaceId: 'local', principalId: 'sam@plant' };
const agent = 'tool-store.repair-triage';
const day = 86_400_000;
let clock = Date.parse('2026-08-03T08:00:00Z');
let keys = 0;
let directory: string;
let instance: Awaited<ReturnType<typeof openEmbeddedInstance>>;
const app = () => instance.application;

const invoke = async (operation: string, input: unknown, who = owner) =>
  (await app().invokeRaw({ operation, input, idempotencyKey: `fixture-${++keys}` }, who)).result;
const read = async (operation: string, input: unknown, who = owner) =>
  (await app().queryRaw({ operation, input }, who)).data;

async function addTool(assetTag: string, description: string, category: string) {
  const tool = (await invoke('tool.create', { assetTag, description, category, bin: 'A-03' })) as {
    id: string;
  };
  return tool.id;
}

/** Lend the tool for a day and take it back in `condition`; the clock moves on ten days. */
async function lendAndReturn(toolId: string, condition: 'ok' | 'damaged', note?: string) {
  await invoke('tool.check-out', {
    toolId,
    borrower: 'E004217',
    workOrder: `WO-${keys}`,
    dueAt: new Date(clock + day).toISOString(),
  });
  clock += day;
  await invoke('tool.return', { toolId, condition, ...(note ? { note } : {}) });
  clock += 9 * day;
}

const tool = async (id: string) =>
  (await read('tool.get', { id })) as { status: string; revision: number };

/** Fixture tools: one beyond repair, one damaged once and repairable, one on the shelf. */
const fixture = { wrench: '', crimper: '', tester: '' };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tool-store-repair-triage-'));
  instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { 'mia@plant': 'attendant', 'sam@plant': 'viewer' },
      services: { now: () => clock },
    }),
    { workspacePath: join(directory, 'workspace') },
  );
  fixture.wrench = await addTool('TC-00601', 'Torque wrench 20-100 Nm', 'torque-tool');
  await lendAndReturn(fixture.wrench, 'ok');
  await lendAndReturn(fixture.wrench, 'damaged', 'Housing cracked through, beyond repair.');
  fixture.crimper = await addTool('TC-00602', 'Crimper 0.5-6 mm2', 'crimper');
  await lendAndReturn(fixture.crimper, 'ok', 'Jaws worn.');
  await lendAndReturn(fixture.crimper, 'damaged', 'Ratchet slips; replace the pawl.');
  fixture.tester = await addTool('TC-00603', 'Insulation tester 5 kV', 'insulation-tester');
  await lendAndReturn(fixture.tester, 'ok');
});
afterAll(async () => {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
});

/** The approval request a run submitted, from its receipt. */
const requestOf = (result: Awaited<ReturnType<typeof runAgentScenario>>) =>
  result.calls.find((call) => call.operation === 'approval.request')?.receipt?.result as {
    id: string;
  };

/** A run that requests approval to retire the wrench, whose latest return was beyond repair. */
const beyondRepair = (revision: number): AgentScenario => ({
  name: 'a tool whose latest return note says beyond repair: approval to retire it is requested',
  agent,
  task: 'Triage TC-00601.',
  issuer: owner,
  script: {
    commands: [
      { operation: 'tool.list', input: { search: 'TC-00601' } },
      { operation: 'tool.get', input: { id: fixture.wrench } },
      { operation: 'loan.list', input: { toolId: fixture.wrench } },
      {
        operation: 'approval.request',
        input: {
          operation: 'tool.retire',
          input: { toolId: fixture.wrench },
          rationale:
            'TC-00601: the note of its latest return says it is beyond repair ("Housing cracked through, beyond repair.").',
          resource: `tool:${fixture.wrench}`,
          baseRevisions: { [`tool:${fixture.wrench}`]: revision },
        },
      },
    ],
  },
  expect: {
    commits: [],
    approvals: [
      {
        operation: 'tool.retire',
        input: { toolId: fixture.wrench },
        resource: `tool:${fixture.wrench}`,
      },
    ],
    outcome: 'succeeded',
  },
  // Nothing changes until an attendant approves.
  async check() {
    expect(await tool(fixture.wrench)).toMatchObject({ status: 'in-repair' });
  },
});

test('the repair triage agent requests approval to retire a worn-out tool and nothing otherwise', async () => {
  const scenarios: AgentScenario[] = [
    beyondRepair((await tool(fixture.wrench)).revision),
    {
      name: 'a tool damaged once with a repairable note: nothing is requested',
      agent,
      task: 'Triage TC-00602.',
      issuer: owner,
      script: {
        commands: [
          { operation: 'tool.list', input: { search: 'TC-00602' } },
          { operation: 'tool.get', input: { id: fixture.crimper } },
          { operation: 'loan.list', input: { toolId: fixture.crimper } },
        ],
      },
      expect: { commits: [], approvals: [], outcome: 'succeeded' },
      async check() {
        expect(await tool(fixture.crimper)).toMatchObject({ status: 'in-repair' });
      },
    },
    {
      name: 'a tool that is not in repair: nothing is requested',
      agent,
      task: 'Triage TC-00603.',
      issuer: owner,
      script: {
        commands: [
          { operation: 'tool.list', input: { search: 'TC-00603' } },
          { operation: 'tool.get', input: { id: fixture.tester } },
        ],
      },
      expect: { commits: [], approvals: [], outcome: 'succeeded' },
    },
    {
      name: 'retiring directly is refused: the agent only requests approval',
      agent,
      task: 'Retire TC-00601 now.',
      issuer: owner,
      script: { commands: [{ operation: 'tool.retire', input: { toolId: fixture.wrench } }] },
      expect: {
        commits: [],
        approvals: [],
        refused: [{ operation: 'tool.retire', code: 'FORBIDDEN' }],
        outcome: 'failed',
      },
    },
    {
      name: 'approval for any command but tool.retire is refused',
      agent,
      task: 'Move TC-00602 to bin A-04.',
      issuer: owner,
      script: {
        commands: [
          {
            operation: 'approval.request',
            input: {
              operation: 'tool.update',
              input: { id: fixture.crimper, bin: 'A-04' },
              rationale: 'Move it.',
            },
          },
        ],
      },
      expect: {
        commits: [],
        approvals: [],
        refused: [{ operation: 'approval.request', code: 'INVALID_INPUT' }],
        outcome: 'failed',
      },
    },
    {
      name: 'reading anything but tools and loans is refused',
      agent,
      task: 'Show the pending approvals.',
      issuer: owner,
      script: { commands: [{ operation: 'approval.list', input: { status: 'pending' } }] },
      expect: {
        commits: [],
        refused: [{ operation: 'approval.list', code: 'FORBIDDEN' }],
        outcome: 'failed',
      },
    },
  ];
  const results = await runAgentScenarios(scenarios, {
    application: app(),
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
});

test("an attendant approves the agent's request and the tool is retired as that attendant", async () => {
  const result = await runAgentScenario(beyondRepair((await tool(fixture.wrench)).revision), {
    application: app(),
    harness: deterministicHarness,
  });
  expect(result.failures).toEqual([]);
  const { id } = requestOf(result);
  // A viewer may read the request but not decide it.
  await expect(invoke('approval.approve', { id }, sam)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(await read('approval.get', { id }, sam)).toMatchObject({ status: 'pending' });
  const approved = await app().invokeRaw(
    { operation: 'approval.approve', input: { id }, idempotencyKey: 'approve-wrench' },
    mia,
  );
  expect(approved.continuation).toMatchObject({
    operation: 'tool.retire',
    result: { id: fixture.wrench, status: 'retired' },
  });
  expect(await tool(fixture.wrench)).toMatchObject({ status: 'retired' });
  expect(await read('approval.get', { id })).toMatchObject({
    status: 'approved',
    requestedBy: 'owner',
    closedBy: 'mia@plant',
  });
});

test('a request whose tool changed since the agent read it conflicts; an attendant rejects it', async () => {
  const revision = (await tool(fixture.crimper)).revision;
  const request = (await invoke('approval.request', {
    operation: 'tool.retire',
    input: { toolId: fixture.crimper },
    rationale: 'TC-00602: worn jaws and a slipping ratchet.',
    resource: `tool:${fixture.crimper}`,
    baseRevisions: { [`tool:${fixture.crimper}`]: revision },
  })) as { id: string };
  await invoke('tool.update', { id: fixture.crimper, bin: 'R-01' });
  await expect(invoke('approval.approve', { id: request.id }, mia)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(await tool(fixture.crimper)).toMatchObject({ status: 'in-repair' });
  await invoke('approval.reject', { id: request.id, reason: 'The EAM repairs it.' }, mia);
  expect(await read('approval.get', { id: request.id })).toMatchObject({
    status: 'rejected',
    closedBy: 'mia@plant',
    reason: 'The EAM repairs it.',
  });
  expect(await tool(fixture.crimper)).toMatchObject({ status: 'in-repair' });
});
