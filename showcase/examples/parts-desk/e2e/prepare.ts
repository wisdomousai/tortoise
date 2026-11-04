/**
 * Prepares one run of the assistant panel's browser test. The spec runs under Node, and the
 * application and the stand-in run under Bun, so the spec calls this script from the repository
 * root:
 *
 *   bun showcase/examples/parts-desk/e2e/prepare.ts <directory>
 *
 * In `<directory>` it writes the deployment policy that `dev.ts` writes for the llama-server stand-in,
 * on a free loopback port, with `responder.ts` as the model's `FIXTURE_RESPONDER`. It creates the
 * workspace `<directory>/workspace` with the trial records, mara as a supervisor and the draft
 * quote Q-00001 for TR-40417, through the commands as the owner. The model server writes the
 * stand-in weights itself (`model.ts`). The last line it prints is the service's environment as
 * JSON: `WORKSPACE_PATH` and `TORTOISE_DEPLOYMENT_POLICY`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL_OWNER, LOCAL_WORKSPACE, openEmbeddedInstance } from '@tortoise/host';
import { llamaServerStandIn } from '@tortoise/model-server/testing';
import { createPartsDeskApplication } from '../application';
import { ASSISTANT_MODEL_PROCESS } from '../contracts/assistant-agent';
import { seedTrialRecords } from '../trial-records';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: bun e2e/prepare.ts <directory>');
mkdirSync(directory, { recursive: true });

/** A loopback port no listener holds, for the stand-in the deployment policy binds. */
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const { port } = server;
server.stop(true);

const policy = join(directory, 'deployment-policy.json');
writeFileSync(
  policy,
  JSON.stringify({
    profile: 'desktop-local',
    mode: 'connected',
    audit: { mode: 'fail-closed' },
    destinations: { 'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 } },
    processes: {
      [ASSISTANT_MODEL_PROCESS]: {
        executable: process.execPath,
        args: [llamaServerStandIn, '--host', '127.0.0.1', '--port', String(port)],
        env: { FIXTURE_RESPONDER: resolve(import.meta.dir, '..', 'responder.ts') },
      },
    },
  }),
);

const workspacePath = join(directory, 'workspace');
const instance = await openEmbeddedInstance(
  createPartsDeskApplication({ members: { mara: 'supervisor' } }),
  { workspacePath },
);
try {
  await seedTrialRecords(instance.application);
  const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
  const { data } = await instance.application.queryRaw(
    { operation: 'customer.list', input: { search: 'U1042' } },
    owner,
  );
  const nordhafen = (data as { items: { id: string; account: string }[] }).items.find(
    (customer) => customer.account === 'U1042',
  )!;
  await instance.application.invokeRaw(
    {
      operation: 'quote.create',
      input: {
        customerId: nordhafen.id,
        transformerSerial: 'TR-40417',
        lines: [
          { partNumber: 'BSH-145-1250', quantity: 1 },
          { partNumber: 'GSK-TC-40', quantity: 2 },
        ],
      },
      idempotencyKey: 'e2e-draft',
    },
    owner,
  );
} finally {
  await instance.close();
}
console.log(JSON.stringify({ WORKSPACE_PATH: workspacePath, TORTOISE_DEPLOYMENT_POLICY: policy }));
