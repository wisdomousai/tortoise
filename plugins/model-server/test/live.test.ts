import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { defineModelEntry } from '@tortoise/agents/models';
import { startHost } from '@tortoise/host/host';
import { runAgentScenario, type AgentScenario } from '@tortoise/testing/agent-scenarios';
import { measure } from '../src/measure';
import { ENTRY, notesApplication, person } from './fixture';

/**
 * A live run, skipped unless LOCAL_MODEL_GGUF names a GGUF file: the plugin starts the real
 * llama.cpp `llama-server` (LLAMA_SERVER, or the one on PATH) through the process port, measures
 * the weights, and the requesting agent runs on it. An instruction-tuned model with tool calls is
 * enough, for example Gemma 4 E4B-it Q4_0. LOCAL_MODEL_LICENSE names the weights' license
 * (Apache-2.0 when unset).
 */
const weights = process.env.LOCAL_MODEL_GGUF;
const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
const license = process.env.LOCAL_MODEL_LICENSE ?? 'Apache-2.0';
const live = weights && executable ? test : test.skip;

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

const requestsNote: AgentScenario = {
  name: 'requests approval for a note on a real model',
  agent: 'note.suggester',
  task: 'Request approval for adding a note with id n1 that says "Call the supplier".',
  issuer: person,
  expect: {
    commits: [],
    approvals: [{ operation: 'note.add', input: { id: 'n1', text: 'Call the supplier' } }],
    outcome: 'succeeded',
  },
};

live(
  'llama-server starts on measured weights and the requesting agent requests approval on it',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-server-live-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const digest = await measure(weights!);
    const entry = defineModelEntry({
      id: ENTRY,
      base: { name: basename(weights!, '.gguf'), digest },
      license,
      contextTokens: 4096,
      agents: ['note.suggester'],
    });
    const port = await freePort();
    const policy = join(directory, 'site-policy.json');
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
        processes: {
          llm: {
            executable,
            args: ['--host', '127.0.0.1', '--port', String(port), '--ctx-size', '4096'],
          },
        },
      }),
    );
    const { application, models } = notesApplication({
      process: 'llm',
      runtime: 'llama-server',
      entry,
      files: { base: weights! },
      pollMs: 250,
      readyTimeoutMs: 120_000,
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
    expect(models.status()).toMatchObject({ state: 'ready' });

    const result = await runAgentScenario(requestsNote, {
      application: host.application,
      harness: models.harness,
    });
    console.log(JSON.stringify(result, null, 2));
    expect(result.failures).toEqual([]);
    // The run names the measured digest of the weights llama-server loaded.
    expect(result.model).toMatchObject({ entry: ENTRY, digest, verified: true });
  },
  300_000,
);
