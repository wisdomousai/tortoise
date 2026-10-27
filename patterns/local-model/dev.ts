import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { defineModelEntry } from '@agent-native/agents/models';
import { measure } from '@agent-native/model-server/measure';
import { llamaServerStandIn } from '@agent-native/model-server/testing';
import { methodSuggester, METHOD_MODEL } from './contracts';

/**
 * Run by `bun run dev:web` before the launch. It writes a site policy that binds the model
 * server process and `local-inference` on port 4375, into a temporary directory because it names
 * absolute paths. By default the process is the llama-server stand-in with `responder.ts` as the model.
 * With `LOCAL_MODEL_GGUF` set, it is the real llama-server (`LLAMA_SERVER`, or the one on
 * `PATH`) on those weights, measured here into the `lab-methods` entry that `LAB_METHOD_MODEL`
 * names. An explicit `AGENT_NATIVE_SITE_POLICY` wins.
 */
const directory = mkdtempSync(join(tmpdir(), 'test-requests-local-model-'));
const port = 4375;
const weights = process.env.LOCAL_MODEL_GGUF;
const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
const listen = ['--host', '127.0.0.1', '--port', String(port)];
let llm: Record<string, unknown>;
if (weights) {
  if (!executable) throw new Error('LOCAL_MODEL_GGUF is set, but no llama-server was found');
  const model = join(directory, 'method-model.json');
  const entry = defineModelEntry({
    id: METHOD_MODEL,
    base: { name: basename(weights, '.gguf'), digest: await measure(weights) },
    license: process.env.LOCAL_MODEL_LICENSE ?? 'Apache-2.0',
    contextTokens: 8192,
    agents: [methodSuggester.id],
  });
  writeFileSync(model, JSON.stringify({ entry, files: { base: weights } }, null, 2));
  process.env.LAB_METHOD_MODEL ??= model;
  llm = { executable, args: [...listen, '--ctx-size', '8192'] };
} else {
  llm = {
    executable: process.execPath,
    args: [llamaServerStandIn, ...listen],
    env: { FIXTURE_RESPONDER: resolve(import.meta.dir, 'responder.ts') },
  };
}
const policy = join(directory, 'site-policy.json');
writeFileSync(
  policy,
  JSON.stringify(
    {
      profile: 'desktop-local',
      mode: 'connected',
      audit: { mode: 'best-effort' },
      // A model that reasons before it answers can take longer than the guard's 30 s default.
      destinations: { 'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 } },
      processes: { llm },
    },
    null,
    2,
  ),
);
process.env.AGENT_NATIVE_SITE_POLICY ??= policy;
console.log(
  weights
    ? `Model: llama-server on ${weights}, port ${port}`
    : `Model: the llama-server stand-in with responder.ts, port ${port}`,
);
