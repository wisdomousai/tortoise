# @agent-native/pattern-lab-requests-local-model

`pattern-lab-requests-local-model` composes the [lab requests pattern](../lab-requests/README.md) unchanged with a method suggester that runs on a local model. When a technician submits a test request, a trigger runs the suggester on the `lab-methods` [model entry](../../docs/glossary.md#model-entry), and the suggester requests approval for the test method the description asks for. The model server plugin measures the weights against the entry and starts llama-server through the [process port](../../docs/glossary.md#process-port).

## Layer

Content (`patterns/*`). It imports the base pattern, the framework, the model server and automation plugins, and the site, network, process and audit plugins.

## Primitives

The pattern is one [application](../../docs/primitives.md#application). It composes:

- the `lab-methods` [model entry](../../docs/primitives.md#model-entry), served by `createModelServer` and named by the agent definition's `models`, so the suggester runs on no other model;
- a [trigger](../../docs/glossary.md#trigger) that starts the agent definition on each submitted test request, with the model server's harness as the automation plugin's `agentHarnesses`;
- [approval requests](../../docs/glossary.md#approval-request), which a technician approves or rejects;
- an [approval dataset](../../docs/primitives.md#approval-dataset) exported from the decided requests, and a fine-tune gated on an [agent scenario](../../docs/glossary.md#agent-scenario) before it serves, in the tests;
- the `llm` process, which a [deployment policy](../../docs/primitives.md#deployment-policy) binds and the [audit log](../../docs/primitives.md#audit-log) records starting.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `contracts.ts` | Browser and server | The `method-suggestions` module with the approval operations and the suggester, and the `llm` model server component |
| `automation.ts` | Server | The trigger that runs the suggester on each submitted test request |
| `model.ts` | Server | `MethodModel` (entry, files and activation), the stand-in entry and weights, and `methodModelFrom` |
| `domain.ts`, `handlers.ts`, `policy.ts` | Server | The `suggestions` slice, the approval handlers and their route |
| `application.ts` | Server | `composeLabRequestsLocalModel`, which returns the application and the model server |
| `screens.tsx`, `ui/suggestions.tsx` | Browser | Suggested methods on the test request screen, the approvals screen and the automation screen |
| `responder.ts` | Stand-in process | The stand-in model's responses: read the request, then request approval for its method |
| `dev.ts` | Dev launch | Writes the site policy for the stand-in, or for llama-server on `LOCAL_MODEL_GGUF` |

The model comes from the deployment. `methodModelFrom` reads the JSON file `LAB_METHOD_MODEL` names, with `entry`, `files` and an optional `activation`. Without it, the pattern serves the stand-in entry. `standInModel` writes the stand-in weights, a fixed text whose digest the entry names, to the temporary directory, because a source export carries no weight files.

The stand-in model is `llamaServerStandIn` from `@agent-native/model-server/testing`, with `FIXTURE_RESPONDER` naming `responder.ts`. It takes llama-server's flags and serves the same OpenAI-compatible API, so the plugin, the harness and the trigger run unchanged.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests-local-model/manifest` | Browser and server | The lab requests and method-suggestions modules, the model server component and the plugin manifests |
| `@agent-native/pattern-lab-requests-local-model/application` | Server | `composeLabRequestsLocalModel` and `createLabRequestsLocalModelApplication` |
| `@agent-native/pattern-lab-requests-local-model/screens` | Browser | The test request screens with suggested methods, the approvals screen and the automation screen |

## Trust boundary

The deployment chooses the entry, the weights and the activation. At every start, the model server proves that the files on disk have the entry's digests, and refuses a fine-tune without a passing activation for exactly those digests. The site policy pins the server executable and binds `local-inference` to loopback. The server needs no network.

The trigger does nothing until a person issues a trigger grant for it. Its runs act as that person, narrowed to the suggester's operations, so a run reads test requests and requests approval but changes nothing. Approving runs `test-request.update` as the approver, so a viewer's approval is refused.

The dataset holds only decided approval requests the exporting caller may see. The test blanks the rationale, which can quote record contents.

## Dependencies

`@agent-native/pattern-lab-requests`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/agents`, `@agent-native/host`, `@agent-native/model-server`, `@agent-native/automation`, `@agent-native/site`, `@agent-native/network`, `@agent-native/process`, `@agent-native/audit`, `@agent-native/frame`, and in tests `@agent-native/testing`.

## Tests

```sh
bun test patterns/lab-requests-local-model/
```

- `test/local-model.test.ts`: a serving host with the stand-in. The server serves the measured stand-in entry, the trigger's run requests approval for the method of a new request, a viewer cannot approve, and the owner's approval updates the request. The audit log records the measured base digest and the run's model. Weights that differ from the entry are refused. Three decided suggestions export as a dataset with the rationale blanked. A fine-tune whose adapter names the dataset is refused without an activation, passes its gate on an evaluation server, and then serves with the adapter and dataset digests.
- `test/live.test.ts`: runs only when `LOCAL_MODEL_GGUF` names a GGUF file. The model server starts the real llama-server on the measured weights, and the trigger's run on it requests approval for a tensile test method.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern, the base or the automation plugin.

```sh
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun test patterns/lab-requests-local-model/test/live.test.ts
```

Run the pattern in the browser, on the stand-in or on real weights:

```sh
cd patterns/lab-requests-local-model
bun run dev:web
LOCAL_MODEL_GGUF=~/models/gemma-4-E4B-it-Q4_0.gguf bun run dev:web
```

The model server listens on `http://127.0.0.1:4375`. Enable the trigger on the automation screen, then submit a test request without a method.

## Skills

- [serve-a-local-model](../../plugins/model-server/skills/serve-a-local-model/SKILL.md)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Agents: local models](../../docs/agents.md#local-models)
- [Model server](../../plugins/model-server/README.md)
- [Automation](../../plugins/automation/README.md)
