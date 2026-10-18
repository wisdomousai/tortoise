# @agent-native/model-server

The model server plugin runs a local model for agents that require one. It hashes the weights it is given and refuses to start when a digest differs from the [model entry](../../docs/glossary.md#model-entry), or when a fine-tune has no passing activation. It starts llama.cpp `llama-server` or vLLM through the [process port](../../docs/glossary.md#process-port), listening on the address the [site policy](../../docs/glossary.md#site-policy) binds to `local-inference`. The [harness](../../docs/glossary.md#harness) it returns records the measured digests on every run. [Agents](../../docs/agents.md#local-models) explains model entries, approval datasets and the gate.

## Layer

Plugins (`plugins/*`). Server only, except `plugin-manifest` and `contracts`.

## Primitives

- [Model entry](../../docs/primitives.md#model-entry): `createModelServer({ entry, files, activation })` serves one entry and refuses files or an activation that do not match it.
- [Process port](../../docs/primitives.md#process-port): `modelServer({ id, runtime })` declares the server as a process. The site policy binds and pins its executable and gives the arguments that set its listening address.
- [Requirement declaration](../../docs/primitives.md#requirement-declaration): `modelServer` declares the process and no [destinations](../../docs/glossary.md#destination). Agents reach the server on `local-inference`, which the host's provider components declare.
- [Agent run](../../docs/primitives.md#agent-run): `harness` is a `localHarness` for the entry, available only while the server is ready.
- [Audit log](../../docs/primitives.md#audit-log): `model.started`, `model.refused` and `model.exited`, each with the entry and its digests. A refusal carries `DIGEST_MISMATCH`, `UNREADABLE`, `NOT_ACTIVATED`, `NOT_READY` or `UNAVAILABLE`.

## Entrypoints

| Import                                       | Runs in            | Contents                                                       |
| -------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| `@agent-native/model-server`                 | server only        | Everything below.                                              |
| `@agent-native/model-server/contracts`       | browser and server | `modelServer`, `ModelRuntime`.                                 |
| `@agent-native/model-server/plugin-manifest` | browser and server | `modelServerPluginManifest`. It declares nothing itself.       |
| `@agent-native/model-server/plugin`          | server only        | `createModelServer`, its options, status and service.          |
| `@agent-native/model-server/arguments`       | server only        | `serverArguments`: what each runtime is told to load.          |
| `@agent-native/model-server/measure`         | server only        | `measure`: the `sha256:` digest of a weights file or directory. |

### Composition

1. List `modelServer({ id: 'llm', runtime: 'llama-server' })` in the manifest's `components`. List `modelServerPluginManifest` after the site, network and process plugin manifests.
2. In the application definition, create the server, add its plugin, and give its harness to whatever runs agents:

   ```ts
   const models = createModelServer({
     process: 'llm',
     runtime: 'llama-server',
     entry: receivingTuned, // defineModelEntry({ id, base, adapter, license, contextTokens, agents })
     files: { base: '/srv/models/qwen2.5-7b-instruct-q4_k_m.gguf', adapter: '/srv/models/receiving-lora.gguf' },
     activation, // the gate's result for this entry
   });
   plugins: [sitePlugin, networkPlugin, processPlugin, models.plugin, createAutomationPlugin({ triggers, agentHarnesses: [models.harness] })];
   ```

3. Bind both in the site policy. The arguments put the server on the address `local-inference` names, and the plugin adds what to load:

   ```json
   "destinations": { "local-inference": { "url": "http://127.0.0.1:8081" } },
   "processes": { "llm": { "executable": "/usr/local/bin/llama-server", "sha256": "…", "args": ["--host", "127.0.0.1", "--port", "8081"] } }
   ```

An agent that names `models: ['receiving-tuned']` then runs only on this server. [Agents](../../docs/agents.md#local-models) describes how entries and agents select each other.

### Start sequence

On a serving host, after every plugin opened:

1. The plugin hashes the base weights and, for a fine-tune, the adapter. A file is hashed as is. A directory, such as a Hugging Face checkout for vLLM, is hashed as the `sha256sum` lines of its files sorted by path, and links are refused.
2. A digest that differs from the entry refuses the start.
3. A fine-tune, which is an entry with an adapter, needs a passing activation for exactly its base, adapter and dataset digests. With `requireActivation`, a base model needs one too. Without it the start is refused.
4. The plugin records `model.started`. With a fail-closed [audit log](../../docs/glossary.md#audit-log), a start that cannot be recorded does not happen.
5. The declared process starts with the binding's arguments and then the load arguments, listed after these steps. A merged fine-tune is loaded in place of its base.
6. The plugin polls `v1/models` through the network port until the entry is listed, then reports `ready`. A server that never lists the entry is stopped and the start refused.
7. A server that exits later reports `exited` with the last line of its stderr.

The load arguments for each runtime:

- **llama-server**: `llama-server --model <weights> [--lora <adapter>] --alias <entry>`.
- **vLLM**: `vllm serve <weights> --served-model-name <entry>`. A LoRA is listed under the entry ID with `--enable-lora --lora-modules`.

`status()` and `harness.availability()` give the state and the reason. `close` stops the server.

`evaluation: true` serves a fine-tune without an activation so its gate can judge it. Only `evaluationHarness` reaches it, and `harness` stays unavailable. Run the gate (`gateModel` in `@agent-native/testing/activation`) with `evaluationHarness` as the candidate. Keep the activation it returns with the deployment's configuration, and start the server normally with it.

## Trust boundary

The deployment chooses the entry, the files and the activation. At every start, this plugin proves only that the files on disk are the ones the entry names, and that a fine-tune passed its gate. Run records then carry `verified: true` with the measured digests.

The server process is trusted to serve what it loaded, and the site policy pins its executable. It declares no destinations. The network plugin's exported rules block its egress where the deployment applies them, and in-process it never gets the proxy.

A harness for an externally run server records the digests it was given with `verified: false`. Such a harness is `localModel` in the automation plugin, or `localHarness` directly.

### Known gaps

- Ollama is not managed, because it keeps models in its own store under its own digests. Run it outside the host and record it as unverified.
- Weights and adapters are not delivered as bundle artifacts by digest, staged or rolled back. The deployment places the files.
- No vLLM and no real fine-tune have run under this plugin. A real llama-server has run with base weights (`test/live.test.ts`). The other tests use a stand-in that takes llama-server's flags.
- One server per plugin, bound to the one `local-inference` destination.
- Hashing large weights at each start takes time, about a second per gigabyte depending on the disk.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/host` for `plugin` and `plugin-manifest`, and `@agent-native/agents` for `localHarness`, model entries and the `local-inference` destination.
- Plugins: the application composes the site, network and process plugins.
- On the host: `llama-server` from llama.cpp, or vLLM.

## Tests

```sh
bun test plugins/model-server
```

`test/model-server.test.ts` serves a notes fixture application with the site, network, process and model server plugins. It starts `test/fixtures/llama-server.ts` through the process port, a stand-in that takes llama-server's flags and answers with an approval request tool call. It covers:

- weights that differ from the entry, refused with the reason given by the harness;
- a fine-tune without an activation, with a failing one and with one for another adapter, each refused;
- the gate on an evaluation server, which fails a scenario the model misses and passes one it meets;
- the activated server serving an [agent scenario](../../docs/glossary.md#agent-scenario), whose run records the entry, the measured base and adapter digests, the dataset digest and `verified: true`;
- a harness serving another entry, refused for an agent that names its model;
- the directory digest, and each runtime's arguments.

`test/live.test.ts` runs only when `LOCAL_MODEL_GGUF` names a GGUF file. The plugin then starts the real llama.cpp `llama-server` (`LLAMA_SERVER`, or the one on `PATH`) on those weights and measures them. It runs a requesting agent's scenario on the server from a plain-language task. `LOCAL_MODEL_LICENSE` names the weights' license, Apache-2.0 when unset.

```sh
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun test plugins/model-server/test/live.test.ts
```

## Skills

- [serve-a-local-model](skills/serve-a-local-model/SKILL.md): declaring a model entry, serving it through this plugin, exporting a dataset and gating a fine-tune.
