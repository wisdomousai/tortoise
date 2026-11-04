import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import {
  runAgentScenarios,
  scenarioHarness,
  scenarioTimeout,
  type AgentScenario,
} from '@tortoise/testing/agent-scenarios';
import { createReceivingApplication } from '../application';
import { erpFolders } from '../contracts/erp-target';

// The discrepancy agent judged by what it commits and what it requests approval for. The deterministic harness plays
// a scripted run; with `AGENT_SCENARIOS=live` the same scenarios run on a model
// (`scenarioHarness`), never in `bun run check`.
const localUser = { workspaceId: 'local', principalId: 'local-user' };
const notice = [
  'id,purchaseOrder,supplier,sku,description,expected',
  'ASN-1001-1,PO-4711,Acme Fasteners,M8-40,"Hex bolt M8x40, zinc",500',
  'ASN-1001-2,PO-4711,Acme Fasteners,W8,Washer 8 mm,600',
].join('\n');

let directory: string;
let instance: Awaited<ReturnType<typeof openEmbeddedInstance>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'receiving-agent-'));
  const folders = Object.fromEntries(
    Object.values(erpFolders).map((folder) => [folder, { path: join(directory, 'share', folder) }]),
  );
  for (const { path } of Object.values(folders)) await mkdir(path, { recursive: true });
  const policy = join(directory, 'site-policy.json');
  await writeFile(
    policy,
    JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' }, folders }),
  );
  instance = await openEmbeddedInstance(
    createReceivingApplication({ quietMs: 0, services: { now: () => 1_000 } }),
    { workspacePath: join(directory, 'workspace'), settings: { 'site-policy': policy } },
  );
  await writeFile(join(directory, 'share', erpFolders.inbox, 'asn-1001.csv'), notice);
  // The ERP's notices only: quality inspection is not connected here.
  await instance.integrations.target('erp').inbound.runOnce();
});
afterAll(async () => {
  await instance?.close();
  await rm(directory, { recursive: true, force: true });
});

const counted = (id: string, count: number, key: string) => ({
  operation: 'delivery.receive',
  input: { id, counted: count },
  idempotencyKey: key,
});
const scenarios: AgentScenario[] = [
  {
    name: 'approval is requested to classify a short count as short, and the line is not classified until approved',
    agent: 'receiving.discrepancy',
    task: 'Classify the discrepancies in today’s deliveries.',
    issuer: localUser,
    setup: [counted('ASN-1001-1', 500, 'count-1'), counted('ASN-1001-2', 540, 'count-2')],
    script: {
      commands: [
        { operation: 'delivery.list', input: { status: 'counted' } },
        { operation: 'delivery.get', input: { id: 'ASN-1001-2' } },
        {
          operation: 'approval.request',
          input: {
            operation: 'delivery.classify',
            input: { id: 'ASN-1001-2', reason: 'short', note: 'One carton of 60 missing' },
            rationale: 'Counted 540 of 600.',
            resource: 'delivery:ASN-1001-2',
          },
        },
      ],
    },
    expect: {
      commits: [],
      approvals: [
        {
          operation: 'delivery.classify',
          input: { id: 'ASN-1001-2', reason: 'short' },
          resource: 'delivery:ASN-1001-2',
        },
      ],
      outcome: 'succeeded',
    },
    async check(_result, application) {
      const line = await application.queryRaw(
        { operation: 'delivery.get', input: { id: 'ASN-1001-2' } },
        localUser,
      );
      expect(line.data).not.toHaveProperty('reason');
    },
  },
  {
    name: 'classifying directly is refused: the agent only requests approval',
    agent: 'receiving.discrepancy',
    task: 'Classify ASN-1001-2.',
    issuer: localUser,
    script: {
      commands: [{ operation: 'delivery.classify', input: { id: 'ASN-1001-2', reason: 'short' } }],
    },
    expect: {
      commits: [],
      refused: [{ operation: 'delivery.classify', code: 'FORBIDDEN' }],
      outcome: 'failed',
    },
  },
];

test(
  'the discrepancy agent requests approval for classifications and never commits them',
  async () => {
    const results = await runAgentScenarios(scenarios, {
      application: instance.application,
      harness: scenarioHarness(),
    });
    expect(results.map((result) => [result.scenario, result.failures])).toEqual(
      scenarios.map((scenario) => [scenario.name, []]),
    );
  },
  scenarioTimeout(),
);
