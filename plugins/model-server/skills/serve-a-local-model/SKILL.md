---
name: serve-a-local-model
description: Serve a local base or fine-tuned model to agents with measured digests, export proposal decisions as a training dataset, and gate a new model on agent scenarios before it serves. Use when an agent must run on a model on this host, when adding or replacing a model entry or LoRA adapter, when preparing fine-tuning data from accepted and rejected proposals, or when binding llama-server or vLLM in a site policy. Covers plugins/model-server, the model entries in packages/agents, exportProposalDataset in packages/runtime and gateModel in packages/testing.
---

# Serve a local model

A model entry names the weights by digest; the model server plugin proves at each start that the files on disk are those weights and that a fine-tune passed its gate, then starts the server through the process port. Read the [plugin README](../../README.md) for the start sequence, the trust boundary and the gaps.

## Before writing

- Pick the runtime: `llama-server` (GGUF files, LoRA adapters) or `vllm` (Hugging Face directories, LoRA modules). Ollama is not managed; run it outside the host as an unverified `localModel`.
- Decide which agents may use the model. A fine-tune made for one task lists those agents in the entry's `agents`, and each such agent lists the entry in its definition's `models` (with `model: 'local'`).
- Compute the digests the entry names with `measure(path)` from `@agent-native/model-server/measure`, or `sha256sum` for a single file.

## Steps

1. **Define the entry** with `defineModelEntry` from `@agent-native/agents/models`: `id` (also the name the server lists), `base: { name, digest }`, an optional `adapter: { kind: 'lora' | 'merged', digest, dataset }`, `license`, `contextTokens` and `agents`.
2. **Name it on the agent**: `models: ['<entry id>']` in `defineAgent`, so the agent never runs on another model.
3. **Declare and compose**: `modelServer({ id, runtime })` from `@agent-native/model-server/contracts` in the manifest's `components`, `modelServerPluginManifest` after the site, network and process manifests, and `createModelServer({ process, runtime, entry, files, activation })` with its `plugin` in `plugins` and its `harness` given to the automation plugin's `agentHarnesses` (or whatever starts the runs).
4. **Bind the site policy**: `local-inference` to a loopback URL, and the process to the server executable, pinned, with the arguments that make it listen there (`--host 127.0.0.1 --port <port>`). The plugin adds the load arguments. Give the binding a `timeoutMs` of a few minutes: a model that reasons before it answers outlasts the guard's default of 30 seconds. Size the agent's `wallTimeMs` budget the same way.
5. **Export training data** with `exportProposalDataset(application, context, { operations, redact })` from `@agent-native/runtime`. It holds only decided proposals the caller may see; redact free-text fields that can carry personal data, the rationale and the rejection reason as the deployment requires. The dataset's `digest` goes into the adapter's `dataset`. Training happens outside the host with the deployment's own tooling.
6. **Gate the model** before it serves: start the server with `evaluation: true`, run `gateModel({ entry, candidate: models.evaluationHarness, baseline, scenarios, application })` from `@agent-native/testing/activation` with the agents' scenarios (the `add-capability` skill covers writing them), and keep the returned activation with the deployment's configuration. Pass it as `activation` for the real start. A failing gate or a changed file refuses the start.

## Checks

```sh
bun test plugins/model-server
bun test examples/<app>/test/agent-scenarios.test.ts
LOCAL_MODEL_GGUF=<weights.gguf> bun test plugins/model-server/test/live.test.ts
```

A run against a real model server is live evidence: report the runtime, the entry and its digests, and the gate's results in `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.
