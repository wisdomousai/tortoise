import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicHarness } from '@agent-native/agents';
import { openEmbeddedInstance } from '@agent-native/host';
import { runAgentScenarios, type AgentScenario } from '@agent-native/testing/agent-scenarios';
import { createNotesAgentsApplication } from '../application';
import { owner } from './fixtures';

// The titler judged by what it commits and what it requests approval for. The deterministic
// harness plays each script; a model harness would ignore it and read the task.
let directory: string;
let instance: Awaited<ReturnType<typeof openEmbeddedInstance>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sample-notes-agents-scenarios-'));
  let next = 0;
  instance = await openEmbeddedInstance(
    createNotesAgentsApplication({ services: { newId: () => `n${++next}` } }),
    { workspacePath: join(directory, 'workspace') },
  );
});
afterAll(async () => {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
});

const untitled = {
  operation: 'note.add',
  input: { title: '', text: 'Shift handover\nLine 2 restarted at 6:10' },
  idempotencyKey: 'untitled',
};
const scenarios: AgentScenario[] = [
  {
    name: 'approval is requested for a title, and the note keeps no title until approved',
    agent: 'note.titler',
    task: 'Give my untitled notes a title.',
    issuer: owner,
    setup: [untitled],
    script: {
      commands: [
        { operation: 'note.list', input: {} },
        { operation: 'note.get', input: { id: 'n1' } },
        {
          operation: 'approval.request',
          input: {
            operation: 'note.update',
            input: { id: 'n1', title: 'Shift handover' },
            rationale: 'The first line of the text.',
            resource: 'note:n1',
            baseRevisions: { 'note:n1': 1 },
          },
        },
      ],
    },
    expect: {
      commits: [],
      approvals: [
        { operation: 'note.update', input: { title: 'Shift handover' }, resource: 'note:n1' },
      ],
      outcome: 'succeeded',
    },
    async check(_result, application) {
      const note = await application.queryRaw(
        { operation: 'note.get', input: { id: 'n1' } },
        owner,
      );
      expect(note.data).toMatchObject({ title: '' });
    },
  },
  {
    name: 'changing a note directly is refused: the titler only requests approval',
    agent: 'note.titler',
    task: 'Title note n1.',
    issuer: owner,
    script: {
      commands: [{ operation: 'note.update', input: { id: 'n1', title: 'Shift handover' } }],
    },
    expect: {
      commits: [],
      refused: [{ operation: 'note.update', code: 'FORBIDDEN' }],
      outcome: 'failed',
    },
  },
];

test('the titler requests approval for titles and never commits them', async () => {
  const results = await runAgentScenarios(scenarios, {
    application: instance.application,
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
});
