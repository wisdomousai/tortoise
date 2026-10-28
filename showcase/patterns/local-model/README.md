# Suggest a method with a local model

A technician submits an oil-test request. A trigger starts a method-suggester agent on a named [model entry](../../../docs/primitives.md#model-entry), and the agent asks a technician to approve its proposed update. The model never receives permission to change the request directly.

## Try the stand-in

From the repository root:

```sh
cd showcase/patterns/local-model
bun run dev:web
```

Enable the trigger on the Automation screen and submit a request without a method. The default launch starts a deterministic stand-in that speaks the model server's API; it is useful for wiring the flow but is not a model-quality test. The server listens on loopback port 4375.

To try explicitly configured weights, set `LOCAL_MODEL_GGUF` to a local GGUF file before launching. `LAB_METHOD_MODEL` can instead name a JSON file with the model entry, files and optional activation. The [model-server guide](../../../plugins/model-server/README.md) describes the required process and policy.

## Model and approval boundary

The deployment selects the `lab-methods` entry and its weights. The model server measures the files at startup and refuses a digest mismatch; a fine-tune also needs a passing activation for those digests. The trigger does nothing until a person issues its grant. A run may read the request and request approval; approval runs the update under the approver's policy, so a viewer cannot commit it.

[`model.ts`](model.ts) defines the entry, [`automation.ts`](automation.ts) declares the trigger, and [`responder.ts`](responder.ts) supplies the stand-in responses.

## Checks

```sh
bun test showcase/patterns/local-model
```

The deterministic test checks measured weights, approval and the fine-tune gate. The live test runs only when `LOCAL_MODEL_GGUF` is explicitly set and a real llama-server is available. Record that live result separately from the stand-in test.
