import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@tortoise/host/host';
import { lotsApplication, person, reviewOnReceive } from './fixture';

/**
 * The live form of `local-approval.test.ts`, skipped unless LOCAL_MODEL_GGUF names a GGUF file:
 * the test starts llama.cpp `llama-server` (LLAMA_SERVER, or the one on PATH) on those weights,
 * the deployment policy binds `local-inference` to it, and a received lot starts a run on the real
 * model. The person approving is the only path to the command.
 */
const weights = process.env.LOCAL_MODEL_GGUF;
const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
const live = weights && executable ? test : test.skip;
const MODEL = 'lot-reviewer-local';

const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

async function until(check: () => Promise<boolean>, timeoutMs: number) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await Bun.sleep(250))
    if (await check()) return;
  throw new Error('Condition not reached');
}

live(
  'a received lot starts a run on a real local model that requests approval for its inspection, and an inspector approves it',
  async () => {
    const port = await freePort();
    const server = Bun.spawn(
      [
        executable!,
        ...['--model', weights!, '--alias', MODEL, '--host', '127.0.0.1'],
        ...['--port', String(port), '--ctx-size', '4096'],
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    cleanup.push(async () => {
      server.kill();
      await server.exited;
    });
    await until(async () => {
      const health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
      return health?.ok === true;
    }, 180_000);

    const directory = await mkdtemp(join(tmpdir(), 'automation-live-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const policy = join(directory, 'deployment-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'best-effort' },
        // A reasoning model's reply can take longer than the guard's default of 30 s.
        destinations: {
          'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 },
        },
      }),
    );
    const host = await startHost(
      lotsApplication({
        triggers: [reviewOnReceive],
        localModel: { model: MODEL },
        network: true,
        intervalMs: 250,
      }).definition,
      {
        workspacePath: join(directory, 'workspace'),
        integration: false,
        settings: { 'deployment-policy': policy },
      },
    );
    cleanup.push(() => host.close());
    const app = host.application;
    const query = async (operation: string, input: unknown): Promise<any> =>
      (await app.queryRaw({ operation, input }, person('ann'))).data;

    await app.invokeRaw(
      {
        operation: 'automation.grant.issue',
        input: { trigger: 'review-on-receive', expiresInMs: 3_600_000 },
      },
      person('ann'),
    );
    await until(
      async () =>
        (await query('automation.trigger.list', {})).items.find(
          (item: { id: string; cursor?: number }) => item.id === 'review-on-receive',
        )?.cursor !== undefined,
      10_000,
    );
    await app.invokeRaw({ operation: 'lot.receive', input: { id: 'l1' } }, person('vic'));
    const trigger = async () =>
      (await query('automation.trigger.list', {})).items.find(
        (item: { id: string }) => item.id === 'review-on-receive',
      );
    await until(async () => (await trigger())?.lastOutcome !== undefined, 200_000);
    // A failed run is an attention item with the run's error; print it, since a model's run varies.
    const failures = (await query('automation.failure.list', {})).items;
    if (failures.length) console.log(JSON.stringify(failures, null, 2));
    expect(await trigger()).toMatchObject({ lastOutcome: 'succeeded', openFailures: 0 });

    const [approval] = (await query('approval.list', { status: 'pending' })).items;
    console.log(JSON.stringify(approval, null, 2));
    expect(approval).toMatchObject({
      operation: 'lot.inspect',
      input: { id: 'l1' },
      requestedBy: 'ann',
      status: 'pending',
    });
    expect((await query('lot.get', { id: 'l1' })).inspections).toBe(0);
    await expect(
      app.invokeRaw(
        { operation: 'approval.approve', input: { id: approval.id }, idempotencyKey: 'by-vic' },
        person('vic'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await app.invokeRaw(
      { operation: 'approval.approve', input: { id: approval.id }, idempotencyKey: 'by-ann' },
      person('ann'),
    );
    expect((await query('lot.get', { id: 'l1' })).inspections).toBe(1);
  },
  420_000,
);
