import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { deterministicHarness } from '@agent-native/agents';
import type { Harness } from '@agent-native/agents/types';
import {
  defineAgent,
  defineCapability,
  defineModule,
  jsonSchema,
  proposalOperations,
  type AnyCapability,
  type InputOf,
  type OutputOf,
  type Proposal,
} from '@agent-native/contracts';
import {
  createApplication,
  createMemoryStorage,
  definePolicy,
  proposalHandlers,
  records,
  type ExecutionContext,
  type HandlerContext,
  type HandlerContribution,
} from '@agent-native/runtime';
import {
  assertAgentScenarios,
  containsValue,
  runAgentScenario,
  runAgentScenarios,
  scenarioRegressions,
  type AgentScenario,
} from '../src/agent-scenarios';

// A fixture application: lots an operator releases, an advisor agent that proposes releases and
// a releaser agent that releases directly, each scoped to the lots it was started on.
type Role = 'operator' | 'viewer';
interface State {
  roles: Record<string, Role>;
  lots: Record<string, { id: string; status: 'held' | 'released' }>;
  proposals: Record<string, Proposal>;
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
  capabilities: [release, hold, getLot, ...Object.values(proposalOperations)],
  agents: [
    defineAgent({
      id: 'lot.advisor',
      title: 'Advisor',
      instructions: 'Propose releasing a held lot whose checks passed.',
      operations: ['lot.get', 'lot.release'],
      resourceTypes: ['lot'],
      model: 'any',
      output: 'propose',
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
const operator = { container: () => 'site', roles: ['operator'] as Role[] };

function application() {
  let ids = 0;
  return createApplication({
    modules: [lotsModule],
    storage: createMemoryStorage<State>({
      roles: { ann: 'operator', vic: 'viewer' },
      lots: { l1: { id: 'l1', status: 'held' }, l2: { id: 'l2', status: 'held' } },
      proposals: {},
    }),
    services: {},
    authorization: definePolicy<State, Role>({
      roleOf: (state, principalId) => state.roles[principalId],
      operations: {
        'lot.release': operator,
        'lot.hold': operator,
        'lot.get': 'open',
        'proposal.submit': 'open',
        'proposal.accept': { container: () => 'site', person: true },
        'proposal.reject': { ...operator, person: true },
        'proposal.expire': 'open',
        'proposal.list': 'open',
        'proposal.get': 'open',
      },
      events: { lot: () => true, proposal: () => true },
    }),
    handlers: [
      handler(release, set('released')),
      handler(hold, set('held')),
      handler(getLot, (input, ctx) => ctx.state.lots[input.id]!),
      ...proposalHandlers<State, {}>({
        store: (state) => state.proposals,
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
  operation: 'proposal.submit',
  input: {
    operation: 'lot.release',
    input: { id },
    rationale: 'Checks passed.',
    resource: `lot:${id}`,
  },
});
const advisorScenario: AgentScenario = {
  name: 'advisor proposes releasing the selected lot',
  agent: 'lot.advisor',
  task: 'Lot l1 passed its checks.',
  issuer: ann,
  resources: ['lot:l1'],
  script: { commands: [{ operation: 'lot.get', input: { id: 'l1' } }, advise('l1')] },
  expect: {
    commits: [],
    proposals: [{ operation: 'lot.release', input: { id: 'l1' }, resource: 'lot:l1' }],
    outcome: 'succeeded',
  },
  async check(_result, app) {
    const lot = await app.queryRaw({ operation: 'lot.get', input: { id: 'l1' } }, ann);
    expect(lot.data).toEqual({ id: 'l1', status: 'held' });
  },
};

describe('agent scenarios with the deterministic harness', () => {
  test('a proposing agent passes when it proposes, and the record is unchanged', async () => {
    const result = await runAgentScenario(advisorScenario, {
      application: application(),
      harness: deterministicHarness,
    });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ passed: true, state: 'succeeded', harness: 'deterministic' });
    expect(result.calls.map((call) => [call.operation, call.outcome])).toEqual([
      ['lot.get', 'read'],
      ['proposal.submit', 'committed'],
    ]);
  });

  test('a direct write by a proposing agent is refused, recorded and judged', async () => {
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

  test('a proposal for a record outside the selection is refused', async () => {
    const result = await runAgentScenario(
      {
        ...advisorScenario,
        name: 'advisor proposes for another lot',
        script: { commands: [advise('l2')] },
        expect: { proposals: [], refused: [{ operation: 'proposal.submit', code: 'FORBIDDEN' }] },
        check: undefined,
      },
      { application: application(), harness: deterministicHarness },
    );
    expect(result.failures).toEqual([]);
    expect(result.calls[0]!.message).toBe('Delegation does not permit the proposed resource');
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
            'proposal.submit',
            { input: advise('l1').input },
            { runId: turn.runId, signal: turn.signal, idempotencyKey: 'b' },
          );
        yield { type: 'text', text: 'Proposed.' };
      },
    };
    const result = await runAgentScenario(advisorScenario, {
      application: application(),
      harness: model,
    });
    expect(result.failures).toEqual([]);
    expect(seen).toEqual([
      {
        prompt: expect.stringContaining('Propose releasing a held lot'),
        tools: ['lot.get', 'proposal.submit'],
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
});
