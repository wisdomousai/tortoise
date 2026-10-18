---
name: serve-a-local-model
description: Serve a local base or fine-tuned model to agents with measured digests, export approval request decisions as a training dataset, and gate a new model on agent scenarios before it serves. Use when an agent must run on a model on this host, when adding or replacing a model entry or LoRA adapter, when preparing fine-tuning data from approved and rejected approval requests, or when binding llama-server or vLLM in a deployment policy. Covers plugins/model-server, the model entries in packages/agents, exportApprovalDataset in packages/runtime and gateModel in packages/testing.
---

# Serve a local model

A [model entry](../../../../docs/glossary.md#model-entry) names the weights by digest. At each start, the model server plugin proves that the files on disk are those weights and that a fine-tune passed its gate. It then starts the server through the [process port](../../../../docs/glossary.md#process-port). [Agents](../../../../docs/agents.md#local-models) explains local models. The [plugin README](../../README.md) gives the start sequence, the trust boundary and the gaps.

## Before writing

- Pick the runtime: `llama-server` for GGUF files and LoRA adapters, or `vllm` for Hugging Face directories and LoRA modules.
- Ollama is not managed. Run it outside the host as an unverified `localModel`.
- Decide which agents may use the model. A fine-tune made for one task lists those agents in the entry's `agents`. Each such agent lists the entry in its definition's `models`, with `model: 'local'`.
- Compute the digests the entry names with `measure(path)` from `@agent-native/model-server/measure`, or with `sha256sum` for a single file.

## Steps

1. Define the entry with `defineModelEntry` from `@agent-native/agents/models`. It takes:
   - `id`, which is also the name the server lists;
   - `base: { name, digest }`;
   - an optional `adapter: { kind: 'lora' | 'merged', digest, dataset }`;
   - `license`, `contextTokens` and `agents`.
2. Name the entry on the agent with `models: ['<entry id>']` in `defineAgent`, so the agent never runs on another model.
3. Declare `modelServer({ id, runtime })` from `@agent-native/model-server/contracts` in the manifest's `components`.
4. Add `modelServerPluginManifest` to the manifest, after the site, network and process manifests.
5. Call `createModelServer({ process, runtime, entry, files, activation })`. Add its `plugin` to `plugins`.
6. Give its `harness` to the automation plugin's `agentHarnesses`, or to whatever starts the runs.
7. In the [deployment policy](../../../../docs/glossary.md#deployment-policy), bind `local-inference` to a loopback URL.
8. Bind the process to the server executable, pinned, with the arguments that make it listen there: `--host 127.0.0.1 --port <port>`. The plugin adds the load arguments.
9. Give that binding a `timeoutMs` of a few minutes. A model that reasons before it answers outlasts the egress guard's default of 30 seconds.
10. Size the agent's `wallTimeMs` budget the same way.
11. Export training data with `exportApprovalDataset(application, context, { operations, redact })` from `@agent-native/runtime`. The [approval dataset](../../../../docs/glossary.md#approval-dataset) holds only decided approval requests the caller may see.
12. Redact free-text fields that can carry personal data, and the rationale and rejection reason, as the deployment requires.
13. Put the dataset's `digest` into the adapter's `dataset`. Training happens outside the host with the deployment's own tooling.
14. Before the model serves, start the server with `evaluation: true`.
15. Run `gateModel({ entry, candidate: models.evaluationHarness, baseline, scenarios, application })` from `@agent-native/testing/activation` with the agents' scenarios. The `add-capability` skill covers writing them.
16. Keep the returned activation with the deployment's configuration.
17. Pass it as `activation` for the real start. A failing gate or a changed file refuses the start.

## Checks

1. Run the tests:

   ```sh
   bun test plugins/model-server
   bun test examples/<app>/test/agent-scenarios.test.ts
   LOCAL_MODEL_GGUF=<weights.gguf> bun test plugins/model-server/test/live.test.ts
   ```

2. Treat a run against a real model server as live evidence. Report the runtime, the entry and its digests, and the gate's results in [implementation status](../../../../docs/implementation-status.md#agents-and-providers).
3. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.
