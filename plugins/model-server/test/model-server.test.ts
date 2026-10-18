import { afterEach, describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activates,
  defineModelEntry,
  type ModelActivation,
  type ModelEntry,
} from '@agent-native/agents/models';
import { toolName } from '@agent-native/agents/types';
import { startHost } from '@agent-native/host/host';
import { gateModel } from '@agent-native/testing/activation';
import { runAgentScenario, type AgentScenario } from '@agent-native/testing/agent-scenarios';
import { serverArguments } from '../src/arguments';
import { measure } from '../src/measure';
import type { ModelServerOptions } from '../src/plugin';
import { ENTRY, notesApplication, person } from './fixture';

const fixture = join(import.meta.dir, 'fixtures', 'llama-server.ts');
const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const dataset = `sha256:${'d'.repeat(64)}`;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

/** Weights on disk, the entry naming them, and a host serving them through the fixture. */
async function site() {
  const directory = await mkdtemp(join(tmpdir(), 'model-server-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const base = randomBytes(4096);
  const adapter = randomBytes(1024);
  const files = { base: join(directory, 'base.gguf'), adapter: join(directory, 'adapter.gguf') };
  await writeFile(files.base, base);
  await writeFile(files.adapter, adapter);
  const entry = defineModelEntry({
    id: ENTRY,
    base: { name: 'fixture-base-1b', digest: sha(base) },
    adapter: { kind: 'lora', digest: sha(adapter), dataset },
    license: 'Apache-2.0',
    contextTokens: 4096,
    agents: ['note.suggester'],
  });
  let hosts = 0;
  async function open(overrides: Partial<ModelServerOptions> = {}) {
    const port = await freePort();
    const policy = join(directory, `site-policy-${++hosts}.json`);
    const call = {
      name: toolName('approval.request'),
      arguments: {
        input: {
          operation: 'note.add',
          input: { id: 'n1', text: 'Call the supplier' },
          rationale: 'Asked to.',
        },
      },
    };
    await writeFile(
      policy,
      JSON.stringify({
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'best-effort' },
        destinations: { 'local-inference': { url: `http://127.0.0.1:${port}` } },
        processes: {
          llm: {
            executable: process.execPath,
            args: [fixture, '--port', String(port)],
            env: { FIXTURE_CALL: JSON.stringify(call) },
          },
        },
      }),
    );
    const { application, models } = notesApplication({
      process: 'llm',
      runtime: 'llama-server',
      entry,
      files,
      pollMs: 50,
      readyTimeoutMs: 20_000,
      ...overrides,
    });
    const host = await startHost(application, {
      workspacePath: join(directory, `workspace-${hosts}`),
      integration: false,
      settings: { 'site-policy': policy },
    });
    cleanup.push(() => host.close());
    // Wait until the server is ready or has refused.
    for (let tries = 0; tries < 400; tries++) {
      if (!['measuring', 'starting', 'stopped'].includes(models.status().state)) break;
      await Bun.sleep(25);
    }
    return { host, models };
  }
  return { directory, entry, files, open };
}

const requestsNote: AgentScenario = {
  name: 'suggests a note',
  agent: 'note.suggester',
  task: 'Suggest a note about the supplier.',
  issuer: person,
  expect: {
    commits: [],
    approvals: [{ operation: 'note.add', input: { id: 'n1' } }],
    outcome: 'succeeded',
  },
};
const expectsOther: AgentScenario = {
  ...requestsNote,
  name: 'suggests a different note',
  expect: { ...requestsNote.expect, approvals: [{ operation: 'note.add', input: { id: 'n2' } }] },
};

describe('a managed model server', () => {
  test('weights that do not match the entry refuse the start, and the harness says why', async () => {
    const share = await site();
    const { models } = await share.open({
      entry: { ...share.entry, base: { ...share.entry.base, digest: `sha256:${'0'.repeat(64)}` } },
    });
    expect(models.status()).toMatchObject({ state: 'refused' });
    const { reason } = models.status() as { reason: string };
    expect(reason).toContain(`measure ${share.entry.base.digest}`);
    expect(await models.harness.availability()).toEqual({ available: false, reason });
  });

  test('a fine-tune without a passing activation for its digests does not serve', async () => {
    const share = await site();
    const failed: ModelActivation = {
      entry: ENTRY,
      base: share.entry.base.digest,
      adapter: share.entry.adapter!.digest,
      dataset,
      scenarios: `sha256:${'a'.repeat(64)}`,
      passed: false,
      results: [],
      regressions: [],
      at: 0,
    };
    for (const activation of [
      undefined,
      failed,
      { ...failed, passed: true, adapter: `sha256:${'b'.repeat(64)}` },
    ]) {
      const { models, host } = await share.open(activation ? { activation } : {});
      expect(models.status()).toMatchObject({
        state: 'refused',
        reason: expect.stringContaining('no passing activation'),
      });
      await host.close();
    }
  });

  test('the gate judges the fine-tune on an evaluation server; once it passes, runs record the measured digests', async () => {
    const share = await site();
    const evaluation = await share.open({ evaluation: true });
    expect(evaluation.models.status().state).toBe('ready');
    expect((await evaluation.models.harness.availability()).available).toBe(false);
    const gate = (scenarios: AgentScenario[]) =>
      gateModel({
        entry: share.entry,
        candidate: evaluation.models.evaluationHarness,
        scenarios,
        application: () => evaluation.host.application,
        now: () => 5_000,
      });
    const blocked = await gate([expectsOther]);
    expect(blocked.activation).toMatchObject({
      passed: false,
      results: [{ scenario: 'suggests a different note', passed: false }],
    });
    const { activation } = await gate([requestsNote]);
    expect(activation).toMatchObject({
      entry: ENTRY,
      base: share.entry.base.digest,
      adapter: share.entry.adapter!.digest,
      dataset,
      passed: true,
      at: 5_000,
    });
    expect(activates(activation, share.entry)).toBe(true);
    await evaluation.host.close();

    const served = await share.open({ activation });
    expect(served.models.status().state).toBe('ready');
    const result = await runAgentScenario(requestsNote, {
      application: served.host.application,
      harness: served.models.harness,
    });
    expect(result.failures).toEqual([]);
    // Provenance: the run names the entry, the measured base and adapter, and the dataset.
    expect(result.model).toEqual({
      provider: 'local',
      model: ENTRY,
      entry: ENTRY,
      digest: share.entry.base.digest,
      adapterDigest: share.entry.adapter!.digest,
      datasetDigest: dataset,
      verified: true,
    });
  });

  test('a harness serving another entry is refused for an agent that names its model', async () => {
    const share = await site();
    const { models, host } = await share.open({ evaluation: true });
    const other = { ...requestsNote, agent: 'note.suggester' };
    const result = await runAgentScenario(other, {
      application: host.application,
      harness: {
        ...models.evaluationHarness,
        model: { ...models.evaluationHarness.model!, entry: 'other-model' },
      },
    });
    expect(result.state).toBe('refused');
  });
});

describe('model files and arguments', () => {
  test('a directory digest covers each file and its path, and refuses links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-dir-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'sub'));
    await writeFile(join(directory, 'config.json'), '{}');
    await writeFile(join(directory, 'sub', 'model.safetensors'), 'weights');
    const hex = (text: string) => createHash('sha256').update(text).digest('hex');
    const expected = `sha256:${hex(`${hex('{}')}  config.json\n${hex('weights')}  sub/model.safetensors\n`)}`;
    expect(await measure(directory)).toBe(expected);
    expect(await measure(join(directory, 'config.json'))).toBe(`sha256:${hex('{}')}`);
    await symlink(join(directory, 'config.json'), join(directory, 'link.json'));
    await expect(measure(directory)).rejects.toThrow('not a file');
  });

  test('each runtime loads the weights and lists them under the entry ID', () => {
    const base: ModelEntry = defineModelEntry({
      id: 'm',
      base: { name: 'b', digest: `sha256:${'1'.repeat(64)}` },
      license: 'MIT',
      contextTokens: 8,
    });
    const lora = {
      ...base,
      adapter: { kind: 'lora' as const, digest: `sha256:${'2'.repeat(64)}` },
    };
    const merged = {
      ...base,
      adapter: { kind: 'merged' as const, digest: `sha256:${'3'.repeat(64)}` },
    };
    const files = { base: '/m/base', adapter: '/m/adapter' };
    expect(serverArguments('llama-server', base, { base: '/m/base' })).toEqual([
      '--model',
      '/m/base',
      '--alias',
      'm',
    ]);
    expect(serverArguments('llama-server', lora, files)).toEqual([
      '--model',
      '/m/base',
      '--lora',
      '/m/adapter',
      '--alias',
      'm',
    ]);
    expect(serverArguments('llama-server', merged, files)).toEqual([
      '--model',
      '/m/adapter',
      '--alias',
      'm',
    ]);
    expect(serverArguments('vllm', lora, files)).toEqual([
      'serve',
      '/m/base',
      '--served-model-name',
      'm-base',
      '--enable-lora',
      '--lora-modules',
      'm=/m/adapter',
    ]);
    expect(() => serverArguments('vllm', lora, { base: '/m/base' })).toThrow('no adapter file');
    expect(() => defineModelEntry({ ...base, base: { name: 'b', digest: 'abc' } })).toThrow(
      'sha256',
    );
    expect(() => defineModelEntry({ ...base, contextTokens: 0 })).toThrow('context size');
  });
});
