import type { AppNames } from './application';
import type { Generated } from './collection';
import { plural, type Names } from './names';

const contract = (
  app: AppNames,
  agent: Names,
  one: Names,
  many: Names,
) => `import { defineAgent } from '@tortoise/contracts';

/**
 * The ${agent.words} agent: it reads ${many.words} and requests approval for ${one.kebab}.update for a person to
 * approve. It holds no write of its own, so nothing changes until someone approves.
 */
export const ${agent.camel}Agent = defineAgent({
  id: '${app.app.kebab}.${agent.kebab}',
  title: '${agent.title}',
  instructions:
    'List open ${many.words} and read each one. When ${one.a} is finished, request approval for ${one.kebab}.update with its id and status done, a short rationale, resource ${one.kebab}:<id> and the revision you read as baseRevisions. A person approves or rejects each request. Never request approval for other commands.',
  operations: ['${one.kebab}.list', '${one.kebab}.get', '${one.kebab}.update', 'approval.list'],
  model: 'any',
  output: 'request-approval',
  budgets: { turns: 8, toolCalls: 30, wallTimeMs: 180_000 },
});
`;

const screen = `import { approvalOperations } from '@tortoise/contracts';
import { ApprovalReview } from '@/components/approval-review';

/** Pending approval requests from every agent, each with Approve and Reject. */
export function ApprovalsScreen() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <ApprovalReview
        title="Pending approvals"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
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
import { openEmbeddedInstance } from '@tortoise/host';
import {
  runAgentScenarios,
  scenarioHarness,
  scenarioTimeout,
  type AgentScenario,
} from '@tortoise/testing/agent-scenarios';
import { create${app.app.pascal}Application } from '../application';

// The ${agent.words} agent judged by what it commits and what it requests approval for. The deterministic harness
// plays a scripted run; with \`AGENT_SCENARIOS=live\` the first test runs them on a model (\`scenarioHarness\`).
const localUser = { workspaceId: 'local', principalId: 'local-user' };
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
    issuer: localUser,
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
        localUser,
      );
      expect(record.data).toMatchObject({ status: 'open' });
    },
  },
  {
    name: 'updating directly is refused: the agent only requests approval',
    agent: '${app.app.kebab}.${agent.kebab}',
    task: 'Close everything.',
    issuer: localUser,
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
    harness: scenarioHarness(),
  });
  expect(results.map((result) => [result.scenario, result.failures])).toEqual(
    scenarios.map((scenario) => [scenario.name, []]),
  );
}, scenarioTimeout());

test('a person approves an approval, and the update commits as that person', async () => {
  const app = instance.application;
  const created = await app.invokeRaw(
    { operation: '${one.kebab}.create', input: { title: 'Approved' }, idempotencyKey: 'create-approved' },
    localUser,
  );
  const id = (created.result as { id: string }).id;
  const requested = await app.invokeRaw(
    {
      operation: 'approval.request',
      input: { operation: '${one.kebab}.update', input: { id, status: 'done' }, rationale: 'Done.' },
      idempotencyKey: 'request-approved',
    },
    localUser,
  );
  await app.invokeRaw(
    {
      operation: 'approval.approve',
      input: { id: (requested.result as { id: string }).id },
      idempotencyKey: 'approve-approved',
    },
    localUser,
  );
  const record = await app.queryRaw({ operation: '${one.kebab}.get', input: { id } }, localUser);
  expect(record.data).toMatchObject({ id, status: 'done' });
});
`;

/** Lines of the access view the approval feature asks, inserted into `policy.ts`. */
const access = [
  '/**',
  ' * Who may do what with approval requests, for the `approval` feature. Members request, read and',
  " * approve them; approving runs the requested command under the approver, so the command's own",
  ' * rule decides. Only editors reject. Integration principals hold no role and reach none of it.',
  ' */',
  'export const approvalAccess = (state: AppState): ApprovalAccess => ({',
  '  allows(context, action) {',
  '    const role = roleOf(state, context.principalId);',
  "    return action === 'reject' ? role === 'editor' : role !== undefined;",
  '  },',
  '});',
];

/** The approval feature's mount in `application.ts`, with the application's ID and clock. */
const mount = [
  'mountFeature<AppState, ApprovalAccess, ApprovalHooks, Services>(approvalFeature(), {',
  '  access: approvalAccess,',
  '  hooks: { newId: (ctx) => newId(ctx), now: (ctx) => now(ctx) },',
  '}),',
];

/**
 * An agent that requests approval for updates to one collection. The first agent also mounts the
 * `approval` feature, with an access view from the workspace roles, and adds a screen listing
 * pending approval requests.
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
  return {
    files: { ...files, 'ui/approvals.tsx': screen },
    insertions: {
      'contracts.ts': {
        imports: [agentImport],
        // Agents request approval through the approval feature's operations.
        requires: ["'approval',"],
        agents: [`${name.camel}Agent,`],
      },
      'manifest.ts': {
        imports: [`import { approvalFeatureManifest } from '@tortoise/contracts';`],
        features: ['approvalFeatureManifest,'],
      },
      'policy.ts': {
        imports: [`import type { ApprovalAccess } from '@tortoise/runtime';`],
        access,
      },
      'application.ts': {
        imports: [
          `import { approvalFeature, type ApprovalAccess, type ApprovalHooks } from '@tortoise/runtime';`,
          `import { mountFeature } from '@tortoise/host/feature';`,
          `import { newId, now } from './handlers/context';`,
          `import { approvalAccess } from './policy';`,
        ],
        features: mount,
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
