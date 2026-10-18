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
 * The ${agent.words} agent: it reads ${many.words} and requests approval for ${one.kebab}.update for a person to
 * approve. It holds no write of its own, so nothing changes until someone approves.
 */
export const ${agent.camel}Agent = defineAgent({
  id: '${app.app.kebab}.${agent.kebab}',
  title: '${agent.title}',
  instructions:
    'List open ${many.words} and read each one. When a ${one.words} is finished, request approval for ${one.kebab}.update with its id and status done, a short rationale, resource ${one.kebab}:<id> and the revision you read as baseRevisions. A person approves or rejects each request. Never request approval for other commands.',
  operations: ['${one.kebab}.list', '${one.kebab}.get', '${one.kebab}.update', 'approval.list'],
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
});
`;

const handlers = `import { approvalHandlers as handlersOf } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { newId, now, type Services } from './context';

/**
 * Requested commands. Every member sees every approval request, as they see every record. Approving runs
 * the requested command under the approver, so the command's own rule decides whether they may.
 */
export function approvalHandlers() {
  return handlersOf<AppState, Services>({
    store: (state) => state.approvals,
    commands: Object.values(operations).filter((operation) => operation.kind === 'command'),
    visible: () => true,
    newId,
    now,
  });
}
`;

const screen = `import { ApprovalReview } from '@/components/approval-review';
import { operations } from '../contracts';

/** Pending approval requests from every agent, each with Approve and Reject. */
export function ApprovalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <ApprovalReview
        title="Pending approvals"
        list={operations.approvalList}
        approve={operations.approvalApprove}
        reject={operations.approvalReject}
        describe={(approval) => \`\${approval.resource ?? ''}: \${approval.operation}\`}
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
import { openEmbeddedInstance } from '@agent-native/host';
import { runAgentScenarios, type AgentScenario } from '@agent-native/testing/agent-scenarios';
import { create${app.app.pascal}Application } from '../application';

// The ${agent.words} agent judged by what it commits and what it requests approval for. The deterministic harness
// plays a scripted run; a model runs the same scenarios only when a test is given one.
const owner = { workspaceId: 'local', principalId: 'owner' };
let ids = 0;
let directory: string;
let instance: Awaited<ReturnType<typeof openEmbeddedInstance>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${agent.kebab}-'));
  instance = await openEmbeddedInstance(
    create${app.app.pascal}Application({
      services: { newId: () => \`${one.kebab}-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath: join(directory, 'workspace') },
  );
});
afterAll(async () => {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
});

const scenarios: AgentScenario[] = [
  {
    name: 'approval is requested to mark a finished ${one.words} done, and it stays open until a person approves',
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
          operation: 'approval.request',
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
      approvals: [{ operation: '${one.kebab}.update', input: { id: '${one.kebab}-1', status: 'done' } }],
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
    name: 'updating directly is refused: the agent only requests approval',
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

test('the ${agent.words} agent requests approval for updates and never commits them', async () => {
  const results = await runAgentScenarios(scenarios, {
    application: instance.application,
    harness: deterministicHarness,
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
});

test('a person approves an approval, and the update commits as that person', async () => {
  const app = instance.application;
  const created = await app.invokeRaw(
    { operation: '${one.kebab}.create', input: { title: 'Approved' }, idempotencyKey: 'create-approved' },
    owner,
  );
  const id = (created.result as { id: string }).id;
  const requested = await app.invokeRaw(
    {
      operation: 'approval.request',
      input: { operation: '${one.kebab}.update', input: { id, status: 'done' }, rationale: 'Done.' },
      idempotencyKey: 'request-approved',
    },
    owner,
  );
  await app.invokeRaw(
    {
      operation: 'approval.approve',
      input: { id: (requested.result as { id: string }).id },
      idempotencyKey: 'approve-approved',
    },
    owner,
  );
  const record = await app.queryRaw({ operation: '${one.kebab}.get', input: { id } }, owner);
  expect(record.data).toMatchObject({ id, status: 'done' });
});
`;

/**
 * An agent that requests approval for updates to one collection. The first agent also adds the approval request
 * operations, their handlers, rules and state, and a screen listing pending approval requests.
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
  const rule = (op: string, value: string) => `[operations.approval${op}.id]: ${value},`;
  return {
    files: { ...files, 'handlers/approvals.ts': handlers, 'ui/approvals.tsx': screen },
    insertions: {
      'contracts.ts': {
        imports: [`import { approvalOperations } from '@agent-native/contracts';`, agentImport],
        operations: ['...approvalOperations,'],
        agents: [`${name.camel}Agent,`],
      },
      'domain.ts': {
        imports: [`import type { ApprovalRequest } from '@agent-native/contracts';`],
        state: ['approvals: Record<string, ApprovalRequest>;'],
        initial: ['approvals: {},'],
      },
      'policy.ts': {
        // Agents request approval; deciding an approval request needs a person.
        rules: [
          rule('Request', '{}'),
          rule('Approve', '{ person: true }'),
          rule('Reject', '{ ...editor, person: true }'),
          rule('Expire', '{}'),
          rule('List', "'open'"),
          rule('Get', "'open'"),
        ],
        events: ["'approval-request': () => true,"],
      },
      'server.ts': {
        imports: [`import { approvalHandlers } from './handlers/approvals';`],
        handlers: ['...(approvalHandlers() as HandlerContribution<AppState, Services>[]),'],
      },
      'screens.tsx': {
        imports: [`import { ApprovalsScreen } from './ui/approvals';`],
        routes: ["{ path: 'approvals', component: ApprovalsScreen },"],
        navigation: ["{ to: '/approvals', label: 'Approvals', icon: List },"],
        'capability-screens': ["{ prefix: 'approval.', to: '/approvals' },"],
      },
    },
  };
}
