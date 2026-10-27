import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { defineModelEntry } from '@agent-native/agents/models';
import { approvalOperations, type ApprovalRequest } from '@agent-native/contracts';
import { startHost } from '@agent-native/host/host';
import { measure } from '@agent-native/model-server/measure';
import { requestOperations } from '@agent-native/pattern-base/contracts';
import { composeTestRequestsLocalModel } from '../application';
import { METHOD_MODEL, methodSuggester } from '../contracts';
import { owner } from './fixtures';

/**
 * A live run, skipped unless LOCAL_MODEL_GGUF names a GGUF file: the model server starts the real
 * llama.cpp `llama-server` (LLAMA_SERVER, or the one on PATH) on the measured weights, and the
 * trigger runs the method suggester on it for a new test request. LOCAL_MODEL_LICENSE names the
 * weights' license (Apache-2.0 when unset).
 */
const weights = process.env.LOCAL_MODEL_GGUF;
const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
const live = weights && executable ? test : test.skip;

const cleanup: (() => Promise<unknown>)[] = [];
// Closing waits for the run's last model turn and for llama-server to stop.
afterAll(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
}, 120_000);

live(
  'the trigger runs the method suggester on llama-server and requests approval for a method',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pattern-local-model-live-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    await new Promise((done) => server.close(done));
    const policy = join(directory, 'site-policy.json');
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'best-effort' },
        destinations: {
          'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 },
        },
        processes: {
          llm: {
            executable,
            args: ['--host', '127.0.0.1', '--port', String(port), '--ctx-size', '8192'],
          },
        },
      }),
    );
    const entry = defineModelEntry({
      id: METHOD_MODEL,
      base: { name: basename(weights!, '.gguf'), digest: await measure(weights!) },
      license: process.env.LOCAL_MODEL_LICENSE ?? 'Apache-2.0',
      contextTokens: 8192,
      agents: [methodSuggester.id],
    });
    const { application, models } = composeTestRequestsLocalModel({
      model: { entry, files: { base: weights! } },
      automationIntervalMs: 100,
      pollMs: 250,
    });
    const host = await startHost(application, {
      workspacePath: join(directory, 'workspace'),
      integration: false,
      settings: { 'site-policy': policy },
    });
    cleanup.push(() => host.close());
    for (let tries = 0; tries < 600; tries++) {
      if (!['measuring', 'starting', 'stopped'].includes(models.status().state)) break;
      await Bun.sleep(250);
    }
    expect(models.status()).toMatchObject({
      state: 'ready',
      model: { entry: METHOD_MODEL, digest: entry.base.digest, verified: true },
    });

    const run = (operation: string, input: unknown, key: string) =>
      host.application.invokeRaw({ operation, input, idempotencyKey: key }, owner);
    await run(
      'automation.grant.issue',
      { trigger: 'suggest-methods-on-local-model', expiresInMs: 3_600_000 },
      'grant',
    );
    await Bun.sleep(500);
    const { id } = (
      await run(
        requestOperations.requestSubmit.id,
        {
          sample: 'OS-24-0417',
          transformer: 'TR-40517',
          description: 'Dissolved gases after a Buchholz alarm',
          method: '',
        },
        'submit',
      )
    ).result as { id: string };
    let suggestion: ApprovalRequest | undefined;
    for (let tries = 0; tries < 1_200 && !suggestion; tries++) {
      const { data } = await host.application.queryRaw(
        { operation: approvalOperations.approvalList.id, input: { status: 'pending' } },
        owner,
      );
      suggestion = (data as { items: ApprovalRequest[] }).items[0];
      if (!suggestion) await Bun.sleep(250);
    }
    console.log(JSON.stringify(suggestion, null, 2));
    expect(suggestion).toMatchObject({
      operation: requestOperations.requestUpdate.id,
      input: { id, method: expect.stringMatching(/gas|60567|D3612/i) },
    });
  },
  300_000,
);
