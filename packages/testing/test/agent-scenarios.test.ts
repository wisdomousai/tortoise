import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { deterministicHarness } from '@tortoise/agents';
import type { Harness } from '@tortoise/agents/types';
import {
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  approvalOperations,
  type AnyCapability,
  type InputOf,
  type OutputOf,
  type ApprovalRequest,
} from '@tortoise/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  approvalHandlers,
  records,
  type ExecutionContext,
  type HandlerContext,
  type HandlerContribution,
} from '@tortoise/runtime';
import {
  assertAgentScenarios,
  containsValue,
  runAgentScenario,
  runAgentScenarios,
  scenarioHarness,
  scenarioRegressions,
  scenarioTimeout,
  type AgentScenario,
} from '../src/agent-scenarios';
import { gateModel, scenariosDigest } from '../src/activation';

// A fixture application: lots an operator releases, an advisor agent that requests approval for releases and
// a releaser agent that releases directly, each scoped to the lots it was started on.
type Role = 'operator' | 'viewer';
interface State {
  roles: Record<string, Role>;
  lots: Record<string, { id: string; status: 'held' | 'released' }>;
  approvals: Record<string, ApprovalRequest>;
}
const lots = { type: 'lot', label: { one: 'Lot', many: 'Lots' } } as const;
const fixture = { ui: { exception: 'test fixture' } } as const;
const lotSchema = z.strictObject({ id: z.string(), status: z.enum(['held', 'released']) });
const release = defineCapability({
  id: 'lot.release',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(lotSchema),
  permission: { action: 'release', resourceType: 'Lot' },
  ui: { binding: 'lot.release' },
});
const hold = defineCapability({
  id: 'lot.hold',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(lotSchema),
  permission: { action: 'write', resourceType: 'Lot' },
  ...fixture,
});
const getLot = defineCapability({
  id: 'lot.get',
  kind: 'query',
  input: jsonSchema(z.strictObject({ id: z.string() })),
  output: jsonSchema(lotSchema),
  permission: { action: 'read', resourceType: 'Lot' },
  ...fixture,
});
const budgets = { turns: 4, toolCalls: 5, wallTimeMs: 10_000 };
const lotsModule = defineModule({
  id: 'lots',
  capabilities: [release, hold, getLot, ...Object.values(approvalOperations)],
  agents: [
    defineAgent({
      id: 'lot.advisor',
      title: 'Advisor',
      instructions: 'Request approval for releasing a held lot whose checks passed.',
      operations: ['lot.get', 'lot.release'],
      resourceTypes: ['lot'],
      model: 'any',
      output: 'request-approval',
      budgets,
    }),
    defineAgent({
      id: 'lot.releaser',
      title: 'Releaser',
      instructions: 'Release the selected lot.',
      operations: ['lot.get', 'lot.release'],
      resourceTypes: ['lot'],
      model: 'any',
      output: 'direct',
      budgets,
    }),
  ],
});
const handler = <C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, ctx: HandlerContext<State, {}>) => OutputOf<C>,
): HandlerContribution<State, {}> =>
  ({ capability, handle }) as unknown as HandlerContribution<State, {}>;
const set =
  (status: 'held' | 'released') => (input: { id: string }, ctx: HandlerContext<State, {}>) => {
    records(ctx, lots, ctx.state.lots).update(input.id, { status });
    return { id: input.id, status };
  };
const operator = { container: () => 'plant', roles: ['operator'] as Role[] };

function application() {
  let ids = 0;
  return createApplication({
    modules: [lotsModule],
    storage: createMemoryStorage<State>({
      roles: { ann: 'operator', vic: 'viewer' },
      lots: { l1: { id: 'l1', status: 'held' }, l2: { id: 'l2', status: 'held' } },
      approvals: {},
    }),
    services: {},
    authorization: definePolicy<State, Role>({
      roleOf: (state, principalId) => state.roles[principalId],
      operations: {
        'lot.release': operator,
        'lot.hold': operator,
        'lot.get': 'open',
        'approval.request': 'open',
        'approval.approve': { container: () => 'plant', person: true },
        'approval.reject': { ...operator, person: true },
        'approval.expire': 'open',
        'approval.list': 'open',
        'approval.get': 'open',
      },
      events: { lot: () => true, approval: () => true },
    }),
    handlers: [
      handler(release, set('released')),
      handler(hold, set('held')),
      handler(getLot, (input, ctx) => ctx.state.lots[input.id]!),
      ...approvalHandlers<State, {}>({
        store: (state) => state.approvals,
        commands: [release],
        visible: () => true,
        newId: () => `p${++ids}`,
        now: () => 1_000,
        ttlMs: 60_000,
      }),
    ],
  });
}

const ann: ExecutionContext = { workspaceId: 'w', principalId: 'ann' };
const advise = (id: string) => ({
  operation: 'approval.request',
  input: {
    operation: 'lot.release',
    input: { id },
    rationale: 'Checks passed.',
    resource: `lot:${id}`,
  },
});
const advisorScenario: AgentScenario = {
  name: 'advisor requests approval for releasing the selected lot',
  agent: 'lot.advisor',
  task: 'Lot l1 passed its checks.',
  issuer: ann,
  resources: ['lot:l1'],
  script: { commands: [{ operation: 'lot.get', input: { id: 'l1' } }, advise('l1')] },
  expect: {
    commits: [],
    approvals: [{ operation: 'lot.release', input: { id: 'l1' }, resource: 'lot:l1' }],
    outcome: 'succeeded',
  },
  async check(_result, app) {
    const lot = await app.queryRaw({ operation: 'lot.get', input: { id: 'l1' } }, ann);
    expect(lot.data).toEqual({ id: 'l1', status: 'held' });
  },
};

describe('agent scenarios with the deterministic harness', () => {
  test('a requesting agent passes when it requests approval, and the record is unchanged', async () => {
    const result = await runAgentScenario(advisorScenario, {
      application: application(),
      harness: deterministicHarness,
    });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ passed: true, state: 'succeeded', harness: 'deterministic' });
    expect(result.calls.map((call) => [call.operation, call.outcome])).toEqual([
      ['lot.get', 'read'],
      ['approval.request', 'committed'],
    ]);
  });

  test('a question is answered from the scenario and counted; one past the last answer cancels', async () => {
    const asking: AgentScenario = {
      ...advisorScenario,
      name: 'advisor asks which lot first',
      script: { ...advisorScenario.script!, question: 'Which lot passed?' },
      answers: ['l1'],
      expect: { ...advisorScenario.expect, questions: 1 },
    };
    const result = await runAgentScenario(asking, {
      application: application(),
      harness: deterministicHarness,
    });
    expect(result.failures).toEqual([]);
    expect(result.questions).toEqual(['Which lot passed?']);
    const unanswered = await runAgentScenario(
      { ...asking, answers: [], check: undefined },
      { application: application(), harness: deterministicHarness },
    );
    expect(unanswered.state).toBe('cancelled');
    expect(unanswered.passed).toBe(false);
  });

  test('a direct write by a requesting agent is refused, recorded and judged', async () => {
    const result = await runAgentScenario(
      {
        ...advisorScenario,
        name: 'advisor tries to release itself',
        script: { commands: [{ operation: 'lot.release', input: { id: 'l1' } }] },
        expect: { commits: [], refused: [{ operation: 'lot.release', code: 'FORBIDDEN' }] },
        check: undefined,
      },
      { application: application(), harness: deterministicHarness },
    );
    expect(result.failures).toEqual([]);
    expect(result.state).toBe('failed');
    expect(result.calls).toEqual([
      {
        operation: 'lot.release',
        input: { id: 'l1' },
        outcome: 'refused',
        code: 'FORBIDDEN',
        message: 'Delegation does not permit operation',
      },
    ]);
  });

  test('an approval for a record outside the selection is refused', async () => {
    const result = await runAgentScenario(
      {
        ...advisorScenario,
        name: 'advisor requests approval for another lot',
        script: { commands: [advise('l2')] },
        expect: { approvals: [], refused: [{ operation: 'approval.request', code: 'FORBIDDEN' }] },
        check: undefined,
      },
      { application: application(), harness: deterministicHarness },
    );
    expect(result.failures).toEqual([]);
    expect(result.calls[0]!.message).toBe('Delegation does not permit the requested resource');
  });

  test('commits beyond the expected ones, outside the selection or a wrong outcome fail it', async () => {
    const app = application();
    const [extra, scoped, wrong] = await runAgentScenarios(
      [
        {
          name: 'releaser releases the selected lot and one more',
          agent: 'lot.releaser',
          task: 'Release l1.',
          issuer: ann,
          resources: ['lot:l1'],
          setup: [{ operation: 'lot.hold', input: { id: 'l1' }, idempotencyKey: 'setup-1' }],
          script: { commands: [{ operation: 'lot.release', input: { id: 'l1' } }] },
          expect: { commits: [], outcome: 'succeeded' },
        },
        {
          name: 'releaser reaches past its selection',
          agent: 'lot.releaser',
          task: 'Release l1.',
          issuer: ann,
          resources: ['lot:l1'],
          script: { commands: [{ operation: 'lot.release', input: { id: 'l2' } }] },
          expect: { commits: [{ operation: 'lot.release', input: { id: 'l2' } }] },
        },
        { ...advisorScenario, expect: { ...advisorScenario.expect, outcome: 'failed' } },
      ],
      { application: app, harness: deterministicHarness },
    );
    expect(extra!.failures).toEqual(['Expected 0 commits, got 1: ["lot.release"]']);
    expect(extra!.commits[0]!.receipt?.revisions).toMatchObject({ 'lot:l1': expect.any(Number) });
    expect(scoped!.calls[0]).toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
    expect(scoped!.failures[0]).toStartWith('Expected 1 commits, got 0');
    // The advisor's check sees l1 released by the first scenario: one application throughout.
    expect(wrong!.failures).toEqual([
      'Expected the run to have failed, it ended succeeded',
      expect.stringContaining('released'),
    ]);
    expect(() => assertAgentScenarios([extra!, scoped!])).toThrow(
      'releaser reaches past its selection (deterministic)',
    );
  });

  test('a model harness gets the instructions and the task, and calls through the envelope', async () => {
    const seen: { prompt: string; tools: string[]; budget: unknown }[] = [];
    const model: Harness = {
      id: 'fixture-model',
      features: { questions: false, approvals: false, resume: false },
      inference: 'local',
      availability: async () => ({ available: true }),
      async *run(turn) {
        seen.push({
          prompt: turn.prompt,
          tools: (turn.tools.definitions ?? []).map((tool) => tool.operation),
          budget: turn.budget,
        });
        const lot = (await turn.tools.execute(
          'lot.get',
          { input: { id: 'l1' } },
          { runId: turn.runId, signal: turn.signal, idempotencyKey: 'a' },
        )) as { data: { status: string } };
        if (lot.data.status === 'held')
          await turn.tools.execute(
            'approval.request',
            { input: advise('l1').input },
            { runId: turn.runId, signal: turn.signal, idempotencyKey: 'b' },
          );
        yield { type: 'text', text: 'Requested approval.' };
      },
    };
    const result = await runAgentScenario(advisorScenario, {
      application: application(),
      harness: model,
    });
    expect(result.failures).toEqual([]);
    expect(seen).toEqual([
      {
        prompt: expect.stringContaining('Request approval for releasing a held lot'),
        tools: ['approval.request', 'lot.get'],
        budget: budgets,
      },
    ]);
    expect(seen[0]!.prompt).toEndWith('Lot l1 passed its checks.');
  });

  test('regressions are scenarios the baseline passed and the candidate fails', () => {
    const result = (scenario: string, passed: boolean) =>
      ({ scenario, passed }) as Parameters<typeof scenarioRegressions>[0][number];
    expect(
      scenarioRegressions(
        [result('a', false), result('b', false), result('c', true)],
        [result('a', true), result('b', false), result('c', true)],
      ),
    ).toEqual(['a']);
    expect(containsValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }] })).toBe(true);
    expect(containsValue({ b: [1, 2] }, { b: [1] })).toBe(false);
  });

  test('the model gate passes a candidate only when every scenario passes, and names regressions', async () => {
    const entry = {
      id: 'lots-tuned',
      base: { name: 'base', digest: `sha256:${'a'.repeat(64)}` },
      adapter: { kind: 'lora' as const, digest: `sha256:${'b'.repeat(64)}` },
      license: 'MIT',
      contextTokens: 4096,
    };
    // A scripted "model" that requests approval when `good`, and does nothing otherwise.
    const scripted = (good: boolean, served?: string): Harness => ({
      id: good ? 'good' : 'bad',
      features: { questions: false, approvals: false, resume: false },
      inference: 'local',
      ...(served ? { model: { provider: 'local', model: served, entry: served } } : {}),
      availability: async () => ({ available: true }),
      async *run(turn) {
        if (good)
          await turn.tools.execute(
            'approval.request',
            { input: advise('l1').input },
            { runId: turn.runId, signal: turn.signal, idempotencyKey: 'p' },
          );
        yield { type: 'text', text: 'ok' };
      },
    });
    const options = { entry, scenarios: [advisorScenario], application, now: () => 7 };
    const failing = await gateModel({
      ...options,
      candidate: scripted(false, entry.id),
      baseline: { entry: 'lots-base', harness: scripted(true) },
    });
    expect(failing.activation).toMatchObject({
      entry: 'lots-tuned',
      adapter: entry.adapter.digest,
      passed: false,
      regressions: ['advisor requests approval for releasing the selected lot'],
      baseline: 'lots-base',
      scenarios: scenariosDigest([advisorScenario]),
      at: 7,
    });
    const passing = await gateModel({ ...options, candidate: scripted(true, entry.id) });
    expect(passing.activation).toMatchObject({ passed: true, regressions: [] });
    await expect(gateModel({ ...options, candidate: scripted(true) })).rejects.toThrow(
      'does not serve model entry lots-tuned',
    );
    expect(scenariosDigest([advisorScenario])).not.toBe(
      scenariosDigest([{ ...advisorScenario, task: 'Another task' }]),
    );
  });
});

test('scenarios run on the deterministic harness unless AGENT_SCENARIOS=live names a loopback model', () => {
  expect(scenarioHarness({}).id).toBe('deterministic');
  expect(() => scenarioHarness({ AGENT_SCENARIOS: 'live' })).toThrow('AGENT_SCENARIOS_URL');
  expect(() =>
    scenarioHarness({
      AGENT_SCENARIOS: 'live',
      AGENT_SCENARIOS_URL: 'https://models.example.invalid/',
      AGENT_SCENARIOS_MODEL: 'gemma',
    }),
  ).toThrow('loopback');
  const live = scenarioHarness({
    AGENT_SCENARIOS: 'live',
    AGENT_SCENARIOS_URL: 'http://127.0.0.1:8080/',
    AGENT_SCENARIOS_MODEL: 'gemma',
  });
  expect([live.id, live.inference, live.model?.model]).toEqual(['local', 'local', 'gemma']);
  expect(scenarioTimeout({})).toBeUndefined();
});
