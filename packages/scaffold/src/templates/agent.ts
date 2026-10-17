import type { AppNames } from './application';
import type { Generated } from './collection';
import { plural, type Names } from './names';

const contract = (
  app: AppNames,
  agent: Names,
  one: Names,
  many: Names,
) => `import { defineAgent } from '@agent-native/contracts';

/**
 * The ${agent.words} agent: it reads ${many.words} and proposes ${one.kebab}.update for a person to
 * accept. It holds no write of its own, so nothing changes until someone accepts.
 */
export const ${agent.camel}Agent = defineAgent({
  id: '${app.app.kebab}.${agent.kebab}',
  title: '${agent.title}',
  instructions:
    'List open ${many.words} and read each one. When a ${one.words} is finished, propose ${one.kebab}.update with its id and status done, a short rationale, resource ${one.kebab}:<id> and the revision you read as baseRevisions. A person accepts or rejects each proposal. Never propose other commands.',
  operations: ['${one.kebab}.list', '${one.kebab}.get', '${one.kebab}.update', 'proposal.list'],
  model: 'any',
  output: 'propose',
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
});
`;

const handlers = `import { proposalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

/**
 * Proposed commands. Every member sees every proposal, as they see every record. Accepting runs
 * the proposed command under the accepter, so the command's own rule decides whether they may.
 */
export function proposalHandlers() {
  return handlersOf<AppState, Services>({
    store: (state) => state.proposals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible: () => true,
    newId,
    now,
  });
}
`;

const screen = `import { ProposalReview } from '@/components/proposal-review';
import { operations } from '../contracts';

/** Open proposals from every agent, each with Accept and Reject. */
export function ProposalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      <ProposalReview
        title="Open proposals"
        list={operations.proposalList}
        accept={operations.proposalAccept}
        reject={operations.proposalReject}
        describe={(proposal) => \`\${proposal.resource ?? ''}: \${proposal.operation}\`}
      />
    </div>
  );
}
`;

const test = (
  app: AppNames,
  agent: Names,
  one: Names,
) => `import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicHarness } from '@agent-native/agents';
import { openEmbeddedAuthority } from '@agent-native/host';
import { runAgentScenarios, type AgentScenario } from '@agent-native/testing/agent-scenarios';
import { create${app.app.pascal}Application } from '../application';

// The ${agent.words} agent judged by what it commits and proposes. The deterministic harness
// plays a scripted run; a model runs the same scenarios only when a test is given one.
const owner = { workspaceId: 'local', principalId: 'owner' };
let ids = 0;
let directory: string;
let authority: Awaited<ReturnType<typeof openEmbeddedAuthority>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${agent.kebab}-'));
  authority = await openEmbeddedAuthority(
    create${app.app.pascal}Application({
      services: { newId: () => \`${one.kebab}-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath: join(directory, 'workspace') },
  );
});
afterAll(async () => {
  await authority?.close();
  await rm(directory, { recursive: true, force: true });
});

const scenarios: AgentScenario[] = [
  {
    name: 'a finished ${one.words} is proposed as done, and stays open until a person accepts',
    agent: '${app.app.kebab}.${agent.kebab}',
    task: 'Close the finished ${one.words}.',
    issuer: owner,
    setup: [
      {
        operation: '${one.kebab}.create',
        input: { title: 'Finished' },
        idempotencyKey: 'create-finished',
      },
    ],
    script: {
      commands: [
        { operation: '${one.kebab}.list', input: { status: 'open' } },
        { operation: '${one.kebab}.get', input: { id: '${one.kebab}-1' } },
        {
          operation: 'proposal.submit',
          input: {
            operation: '${one.kebab}.update',
            input: { id: '${one.kebab}-1', status: 'done' },
            rationale: 'Its work is finished.',
            resource: '${one.kebab}:${one.kebab}-1',
          },
        },
      ],
    },
    expect: {
      commits: [],
      proposals: [{ operation: '${one.kebab}.update', input: { id: '${one.kebab}-1', status: 'done' } }],
      outcome: 'succeeded',
    },
    async check(_result, application) {
      const record = await application.queryRaw(
        { operation: '${one.kebab}.get', input: { id: '${one.kebab}-1' } },
        owner,
      );
      expect(record.data).toMatchObject({ status: 'open' });
    },
  },
  {
    name: 'updating directly is refused: the agent only proposes',
    agent: '${app.app.kebab}.${agent.kebab}',
    task: 'Close everything.',
    issuer: owner,
    script: {
      commands: [{ operation: '${one.kebab}.update', input: { id: 'any', status: 'done' } }],
    },
    expect: {
      commits: [],
      refused: [{ operation: '${one.kebab}.update', code: 'FORBIDDEN' }],
      outcome: 'failed',
    },
  },
];

test('the ${agent.words} agent proposes updates and never commits them', async () => {
  const results = await runAgentScenarios(scenarios, {
    application: authority.application,
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
});

test('a person accepts a proposal, and the update commits as that person', async () => {
  const app = authority.application;
  const created = await app.invokeRaw(
    { operation: '${one.kebab}.create', input: { title: 'Accepted' }, idempotencyKey: 'create-accepted' },
    owner,
  );
  const id = (created.result as { id: string }).id;
  const proposed = await app.invokeRaw(
    {
      operation: 'proposal.submit',
      input: { operation: '${one.kebab}.update', input: { id, status: 'done' }, rationale: 'Done.' },
      idempotencyKey: 'propose-accepted',
    },
    owner,
  );
  await app.invokeRaw(
    {
      operation: 'proposal.accept',
      input: { id: (proposed.result as { id: string }).id },
      idempotencyKey: 'accept-accepted',
    },
    owner,
  );
  const record = await app.queryRaw({ operation: '${one.kebab}.get', input: { id } }, owner);
  expect(record.data).toMatchObject({ id, status: 'done' });
});
`;

/**
 * An agent that proposes updates to one collection. The first agent also adds the proposal
 * operations, their handlers, rules and state, and a screen listing open proposals.
 */
export function agent(app: AppNames, name: Names, one: Names, first: boolean): Generated {
  const many = plural(one);
  const files: Record<string, string> = {
    [`contracts/${name.kebab}-agent.ts`]: contract(app, name, one, many),
    [`test/${name.kebab}-agent.test.ts`]: test(app, name, one),
  };
  const agentImport = `import { ${name.camel}Agent } from './contracts/${name.kebab}-agent';`;
  if (!first)
    return {
      files,
      insertions: { 'contracts.ts': { imports: [agentImport], agents: [`${name.camel}Agent,`] } },
    };
  const rule = (op: string, value: string) => `[operations.proposal${op}.id]: ${value},`;
  return {
    files: { ...files, 'handlers/proposals.ts': handlers, 'ui/proposals.tsx': screen },
    insertions: {
      'contracts.ts': {
        imports: [`import { proposalOperations } from '@agent-native/contracts';`, agentImport],
        operations: ['...proposalOperations,'],
        agents: [`${name.camel}Agent,`],
      },
      'domain.ts': {
        imports: [`import type { Proposal } from '@agent-native/contracts';`],
        state: ['proposals: Record<string, Proposal>;'],
        initial: ['proposals: {},'],
      },
      'policy.ts': {
        // Agents submit; deciding a proposal needs a person.
        rules: [
          rule('Submit', '{}'),
          rule('Accept', '{ person: true }'),
          rule('Reject', '{ ...editor, person: true }'),
          rule('Expire', '{}'),
          rule('List', "'open'"),
          rule('Get', "'open'"),
        ],
        events: ['proposal: () => true,'],
      },
      'server.ts': {
        imports: [`import { proposalHandlers } from './handlers/proposals';`],
        handlers: ['...(proposalHandlers() as HandlerContribution<AppState, Services>[]),'],
      },
      'screens.tsx': {
        imports: [`import { ProposalsScreen } from './ui/proposals';`],
        routes: ["{ path: 'proposals', component: ProposalsScreen },"],
        navigation: ["{ to: '/proposals', label: 'Proposals', icon: List },"],
        'capability-screens': ["{ prefix: 'proposal.', to: '/proposals' },"],
      },
    },
  };
}
