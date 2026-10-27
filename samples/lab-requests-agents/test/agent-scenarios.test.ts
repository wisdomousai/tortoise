import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicHarness } from '@agent-native/agents';
import { openEmbeddedInstance } from '@agent-native/host';
import { runAgentScenarios, type AgentScenario } from '@agent-native/testing/agent-scenarios';
import { createLabRequestsAgentsApplication } from '../application';
import { owner } from './fixtures';

// The method suggester judged by what it commits and what it requests approval for. The
// deterministic harness plays each script; a model harness would ignore it and read the task.
let directory: string;
let instance: Awaited<ReturnType<typeof openEmbeddedInstance>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sample-lab-requests-agents-scenarios-'));
  let next = 0;
  instance = await openEmbeddedInstance(
    createLabRequestsAgentsApplication({ services: { newId: () => `r${++next}` } }),
    { workspacePath: join(directory, 'workspace') },
  );
});
afterAll(async () => {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
});

const withoutMethod = {
  operation: 'test-request.submit',
  input: { specimen: 'Bracket B-12', description: 'Rockwell hardness after heat treatment' },
  idempotencyKey: 'without-method',
};
const scenarios: AgentScenario[] = [
  {
    name: 'approval is requested for a method, and the request keeps no method until approved',
    agent: 'test-request.method-suggester',
    task: 'Suggest test methods for requests that have none.',
    issuer: owner,
    setup: [withoutMethod],
    script: {
      commands: [
        { operation: 'test-request.list', input: {} },
        { operation: 'test-request.get', input: { id: 'r1' } },
        {
          operation: 'approval.request',
          input: {
            operation: 'test-request.update',
            input: { id: 'r1', method: 'ASTM E18 Rockwell hardness' },
            rationale: 'The test its description names.',
            resource: 'test-request:r1',
            baseRevisions: { 'test-request:r1': 1 },
          },
        },
      ],
    },
    expect: {
      commits: [],
      approvals: [
        {
          operation: 'test-request.update',
          input: { method: 'ASTM E18 Rockwell hardness' },
          resource: 'test-request:r1',
        },
      ],
      outcome: 'succeeded',
    },
    async check(_result, application) {
      const request = await application.queryRaw(
        { operation: 'test-request.get', input: { id: 'r1' } },
        owner,
      );
      expect(request.data).toMatchObject({ method: '' });
    },
  },
  {
    name: 'changing a request directly is refused: the suggester only requests approval',
    agent: 'test-request.method-suggester',
    task: 'Set the method of test request r1.',
    issuer: owner,
    script: {
      commands: [
        {
          operation: 'test-request.update',
          input: { id: 'r1', method: 'ASTM E18 Rockwell hardness' },
        },
      ],
    },
    expect: {
      commits: [],
      refused: [{ operation: 'test-request.update', code: 'FORBIDDEN' }],
      outcome: 'failed',
    },
  },
];

test('the method suggester requests approval for methods and never commits them', async () => {
  const results = await runAgentScenarios(scenarios, {
    application: instance.application,
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
});
