---
name: serve-a-local-model
description: Serve a local base or fine-tuned model to agents with measured digests, export approval request decisions as a training dataset, and gate a new model on agent scenarios before it serves. Use when an agent must run on a model on this host, when adding or replacing a model entry or LoRA adapter, when preparing fine-tuning data from approved and rejected approval requests, or when binding llama-server or vLLM in a deployment policy. Covers plugins/model-server, the model entries in packages/agents, exportApprovalDataset in packages/runtime and gateModel in packages/testing.
---

# Serve a local model

A model entry names the weights by digest. At each start, the model server plugin proves that the files on disk are those weights and that a fine-tune passed its gate. It then starts the server through the process port.

## Before writing

- Pick the runtime: `llama-server` for GGUF files and LoRA adapters, or `vllm` for Hugging Face directories and LoRA modules.
- Ollama is not managed. Run it outside the host as an unverified `localModel`.
- Decide which agents may use the model. A fine-tune made for one task lists those agents in the entry's `agents`. Each such agent lists the entry in its definition's `models`, with `model: 'local'`.
- `showcase/patterns/local-model` runs an agent from a trigger on a served entry, exports a dataset from its decided approval requests and gates a fine-tune on it.
- Compute the digests the entry names with `measure(path)` from `@tortoise/model-server/measure`, or with `sha256sum` for a single file.

## Steps

1. Define the entry with `defineModelEntry` from `@tortoise/agents/models`. It takes:
   - `id`, which is also the name the server lists;
   - `base: { name, digest }`;
   - an optional `adapter: { kind: 'lora' | 'merged', digest, dataset }`;
   - `license`, `contextTokens` and `agents`.
2. Name the entry on the agent with `models: ['<entry id>']` in `defineAgent`, so the agent never runs on another model.
3. Declare `modelServer({ id, runtime })` from `@tortoise/model-server/contracts` in the manifest's `components`.
4. Add `modelServerPluginManifest` to the manifest, after the deployment, network and process manifests.
5. Call `createModelServer({ process, runtime, entry, files, activation })`. Add its `plugin` to `plugins`.
6. Give its `harness` to the automation plugin's `agentHarnesses` for trigger runs. The plugin also offers it to the host's run route, so a run a person starts with an `agentId` and no `harnessId` runs on it when the agent's model requirement admits it.
7. In the deployment policy, bind `local-inference` to a loopback URL.
8. Bind the process to the server executable, pinned, with the arguments that make it listen there: `--host 127.0.0.1 --port <port>`. The plugin adds the load arguments.
9. Give that binding a `timeoutMs` of a few minutes. A model that reasons before it responds outlasts the network guard's default of 30 seconds.
10. Size the agent's `wallTimeMs` budget the same way.
11. Export training data with `exportApprovalDataset(application, context, { operations, redact })` from `@tortoise/runtime`. The approval dataset contains only decided approval requests the caller may see.
12. Redact free-text fields that can include personal data, and the rationale and rejection reason, as the deployment requires.
13. Put the dataset's `digest` into the adapter's `dataset`. Training happens outside the host with the deployment's own tooling.
14. Before the model serves, start the server with `evaluation: true`.
15. Run `gateModel({ entry, candidate: models.evaluationHarness, baseline, scenarios, application })` from `@tortoise/testing/activation` with the agents' scenarios. The `add-capability` skill covers writing them.
16. Keep the returned activation with the deployment's configuration.
17. Pass it as `activation` for the real start. A failing gate or a changed file refuses the start.

## Checks

In tests and development launches, bind the process to Bun with `llamaServerStandIn` from `@tortoise/model-server/testing` as its first argument. It takes llama-server's flags. `FIXTURE_RESPONDER` names a module whose default `StandInResponder` scripts the model's replies.

1. Run the tests:

   ```sh
   bun test plugins/model-server
   bun test showcase/patterns/local-model/
   bun test showcase/examples/<app>/test/<name>-agent.test.ts
   LOCAL_MODEL_GGUF=<weights.gguf> bun test plugins/model-server/test/live.test.ts
   ```

2. Treat a run against a real model server as live evidence. Report the runtime, the entry and its digests, and the gate's results in [implementation status](../../../../docs/implementation-status.md#agents-and-providers).
3. Follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) for the rest.

## References

- [Agents](../../../../docs/agents.md#local-models)
- [`@tortoise/model-server`](../../README.md)
- [Local model pattern](../../../../showcase/patterns/local-model/README.md)
