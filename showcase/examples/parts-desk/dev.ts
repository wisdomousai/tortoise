/**
 * Trial records and the assistant's model server for a development launch.
 * `scripts/dev-example.ts` (`dev:web` and `dev` in this directory) imports this file after the web
 * build and before the host starts.
 *
 * First it chooses the model server. It writes a deployment policy into a temporary directory,
 * because the policy names absolute paths, and sets `TORTOISE_SITE_POLICY` to it unless that
 * is already set. The policy binds `local-inference` to http://127.0.0.1:4389 with a timeout of
 * 300 seconds, since a model that reasons before it responds outlasts the network guard's default
 * of 30 seconds, and binds the `llm` process, pinned by its digest, to listen on that port. By
 * default the process is the llama-server stand-in, which plays the model with `responder.ts` on
 * the stand-in weights (`model.ts`). With `LOCAL_MODEL_GGUF` set, it is llama-server
 * (`LLAMA_SERVER`, or the one on `PATH`) on those weights: this launch measures them into the
 * `parts-desk-assistant` entry and names the entry in `PARTS_DESK_MODEL`, so the model server
 * serves exactly the file it measured here. `LOCAL_MODEL_LICENSE` names the weights' license,
 * Apache-2.0 when unset. The launch prints which one runs.
 *
 * Then it opens the workspace the host is about to serve in this process, creates the trial
 * records through the commands (`trial-records.ts`) and closes it again, which releases the
 * workspace lock for the host. A relaunch replays the stored receipts and adds nothing. A host
 * already running on the workspace holds the lock, so the launch fails with CONFLICT instead of
 * writing beside it.
 *
 * A workspace this launch creates has the member mara, a supervisor, besides the local user. Members
 * are set only when the workspace is created, so a workspace from an earlier launch keeps the
 * members it has; remove `.workspace` to start again with mara.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openEmbeddedInstance, readPluginSettings } from '@tortoise/host';
import { measure } from '@tortoise/model-server/measure';
import { llamaServerStandIn } from '@tortoise/model-server/testing';
import { ASSISTANT_MODEL_PROCESS } from './contracts/assistant-agent';
import manifest from './manifest';
import { ASSISTANT_CONTEXT_TOKENS, assistantModelEntry } from './model';
import { seedTrialRecords } from './trial-records';

const port = 4389;
const directory = mkdtempSync(join(tmpdir(), 'parts-desk-dev-'));
// The policy and the model file serve this launch only.
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
const weights = process.env.LOCAL_MODEL_GGUF;
const listen = ['--host', '127.0.0.1', '--port', String(port)];
/** The binding's pin: the lower-case hex SHA-256 the process plugin checks before every start. */
const pin = async (path: string) => (await measure(path)).slice('sha256:'.length);

let digest: string | undefined;
if (weights) {
  digest = await measure(weights);
  const entry = assistantModelEntry(
    { name: basename(weights, '.gguf'), digest },
    process.env.LOCAL_MODEL_LICENSE ?? 'Apache-2.0',
  );
  const model = join(directory, 'model.json');
  writeFileSync(model, JSON.stringify({ entry, files: { base: weights } }, null, 2));
  process.env.PARTS_DESK_MODEL ??= model;
}

if (process.env.TORTOISE_SITE_POLICY) {
  console.log(
    `Model server: the llm process that ${process.env.TORTOISE_SITE_POLICY} binds, on ${weights ?? 'the stand-in weights'}`,
  );
} else {
  let llm: Record<string, unknown>;
  if (weights) {
    const executable = process.env.LLAMA_SERVER ?? Bun.which('llama-server');
    if (!executable)
      throw new Error('LOCAL_MODEL_GGUF is set, but no llama-server was found; set LLAMA_SERVER');
    llm = {
      executable,
      sha256: await pin(executable),
      args: [...listen, '--ctx-size', String(ASSISTANT_CONTEXT_TOKENS)],
    };
    console.log(`Model server: llama-server ${executable} on ${weights} (${digest}), port ${port}`);
  } else {
    llm = {
      executable: process.execPath,
      sha256: await pin(process.execPath),
      args: [llamaServerStandIn, ...listen],
      env: { FIXTURE_RESPONDER: join(import.meta.dir, 'responder.ts') },
    };
    console.log(`Model server: the llama-server stand-in with responder.ts, port ${port}`);
  }
  const policy = join(directory, 'site-policy.json');
  writeFileSync(
    policy,
    JSON.stringify(
      {
        profile: 'desktop-local',
        mode: 'connected',
        audit: { mode: 'fail-closed' },
        destinations: {
          'local-inference': { url: `http://127.0.0.1:${port}`, timeoutMs: 300_000 },
        },
        processes: { [ASSISTANT_MODEL_PROCESS]: llm },
      },
      null,
      2,
    ),
  );
  process.env.TORTOISE_SITE_POLICY = policy;
}

// The application reads PARTS_DESK_MODEL when it is defined, so it is imported only now.
const { createPartsDeskApplication } = await import('./application');

// The launch serves WORKSPACE_PATH when it is set and this directory's .workspace otherwise.
const workspacePath = process.env.WORKSPACE_PATH ?? join(import.meta.dir, '.workspace');
const application = createPartsDeskApplication({ members: { mara: 'supervisor' } });
const instance = await openEmbeddedInstance(application, {
  workspacePath,
  // The plugins open with the settings the host gives them, such as a site policy.
  settings: readPluginSettings(manifest, process.env),
});
try {
  await seedTrialRecords(instance.application);
} finally {
  await instance.close();
}
